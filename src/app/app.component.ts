import { Component, ElementRef, ViewChild } from '@angular/core';
import * as dicomParser from 'dicom-parser';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import embed, { VisualizationSpec } from 'vega-embed';
import {
  CornerstoneColormap,
  CornerstoneImage,
  Offset,
  RoiData,
  StackToolState,
  Synchronizer,
} from './cornerstone-types';
import {
  cornerstone,
  cornerstoneTools,
  CornerstoneService,
  ToolName,
  cornerstoneNIFTIImageLoader,
  cornerstoneWADOImageLoader,
  getToolFromName,
} from './cornerstone.service';
import { ImageMetadataService } from './image-metadata.service';
import { BBox, getBoundingBox, roisAreEqual } from './utils';

setWasmPaths(`${document.location.href}assets/`);
tf.setBackend('wasm').then((loadedTFWasm) => {
  console.log('loadedTFWasm: ', loadedTFWasm);
});

const resizeImage = (
  imagePixels: Array<number>,
  size: { height: number; width: number },
  newSize: { height: number; width: number }
): tf.Tensor3D => {
  const imageTensor = tf.tidy(() => {
    const tensor = tf.tensor3d(
      imagePixels,
      [size.height, size.width, 1],
      'int32'
    );
    return tf.image.resizeBilinear(tensor, [newSize.height, newSize.width]);
  });
  return imageTensor;
};

type ParsingResult =
  | {
      warnings: string[];
      pixelData?: dicomParser.Element;
      info: { [key: string]: string };
      filteredInfo: { [key: string]: string };
    }
  | {
      parsingError: string;
    };

type DiffPoint = {
  x: number;
  y: number;
  left: number;
  right: number;
  index: number;
  diff: number;
};

type DiffData = {
  array: Array<DiffPoint>;
  max: number;
  min: number;
  sum: number;
  points: Array<Offset>;
  imageId: string;
};

type ImageStackData = {
  uuid: string;
  points: Array<Offset>;
  diffData?: DiffData;
  stats: {
    count: number;
    mean: number;
    variance: number;
    area: number;
  };
};

class ImageData {
  constructor(
    getElement: () => HTMLDivElement,
    { isLeft }: { isLeft: boolean }
  ) {
    this.getElement = getElement;
    this.isLeft = isLeft;
  }
  isLeft: boolean;

  loading = false;
  loaded = false;
  visible = true;
  synchronized = true;
  opacity = 0.7;
  parsingResult?: ParsingResult = undefined;
  getElement: () => HTMLDivElement;
  imageId?: string;

  dynamicImage?: CornerstoneImage;
  overlayLayerId?: string;
  layerId?: string;

  roiPointsByStack: { [key: string]: ImageStackData }[] = [];

  currentStackIndex = (): number => {
    const stackState = cornerstoneTools.getToolState(
      this.getElement(),
      'stack'
    ) as StackToolState;
    return stackState.data[0].currentImageIdIndex;
  };

  currentStackPoints = (
    stackIndex?: number
  ): { [key: string]: ImageStackData } | undefined => {
    if (stackIndex === undefined) {
      try {
        stackIndex = this.currentStackIndex();
      } catch (_) {
        return undefined;
      }
    }
    return this.roiPointsByStack[stackIndex];
  };

  setPoints = (stackIndex: number, data: RoiData): void => {
    let map = this.roiPointsByStack[stackIndex];
    if (!map) {
      map = {};
      this.roiPointsByStack[stackIndex] = map;
    }
    map[data.uuid] = {
      uuid: data.uuid,
      points: data.handles.points.map((p) => ({ ...p })),
      stats: { ...data.meanStdDev, area: data.area },
    };
  };

  getRoiPixels = (): Array<{
    uuid: string;
    pixels: number[];
    bbox: BBox;
    points: Array<Offset>;
  }> => {
    const pointsMap = this.currentStackPoints();

    if (!pointsMap) {
      return [];
    }

    return Object.entries(pointsMap).map(([uuid, { points }]) => {
      const sourceBBox = getBoundingBox(points);
      return {
        pixels: cornerstone.getPixels(
          this.getElement(),
          sourceBBox.left,
          sourceBBox.top,
          sourceBBox.width,
          sourceBBox.height
        ),
        bbox: sourceBBox,
        points,
        uuid,
      };
    });
  };

  getData = (histogramRegion: HistogramRegion, lastRoiUuid: string) => {
    let filter: (d: ImageStackData) => boolean;
    switch (histogramRegion) {
      case HistogramRegion.lastRoi:
        filter = (d) => d.uuid === lastRoiUuid;
        break;
      case HistogramRegion.stackPosition:
        const curr = this.currentStackPoints();
        filter = (d) => curr !== undefined && curr[d.uuid] !== undefined;
        break;
      case HistogramRegion.volume:
        filter = (_) => true;
        break;
    }

    return this.roiPointsByStack
      .flatMap((v) => Object.values(v))
      .filter((v) => v.diffData !== undefined && filter(v));
  };

  removeData = (
    histogramRegion: HistogramRegion,
    lastRoiUuid: string
  ): boolean => {
    if (!this.loaded) {
      return false;
    }
    let didChange = false;
    switch (histogramRegion) {
      case HistogramRegion.lastRoi:
        if (lastRoiUuid !== undefined) {
          for (const arr of this.roiPointsByStack) {
            if (arr !== undefined && arr[lastRoiUuid] !== undefined) {
              delete arr[lastRoiUuid];
              didChange = true;
            }
          }
        }
        break;
      case HistogramRegion.stackPosition:
        const index = this.currentStackIndex();
        didChange =
          this.roiPointsByStack[index] !== undefined &&
          Object.keys(this.roiPointsByStack[index]).length > 0;
        this.roiPointsByStack[index] = {};
        break;
      case HistogramRegion.volume:
        didChange = this.roiPointsByStack.length > 0;
        this.roiPointsByStack = [];
        break;
    }
    if (didChange) {
      cornerstoneTools.clearToolState(this.getElement(), ToolName.FreehandRoi);
      cornerstone.updateImage(this.getElement(), true);
    }
    return didChange;
  };
}

enum InfoView {
  Comparison = 'Comparison',
  Metadata = 'Metadata',
}

enum HistogramType {
  dist,
  diff,
}

enum HistogramRegion {
  volume = 'volume',
  lastRoi = 'lastRoi',
  stackPosition = 'stackPosition',
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  ToolName = ToolName;
  InfoView = InfoView;
  HistogramType = HistogramType;
  HistogramRegion = HistogramRegion;
  colormaps = cornerstone.colors.getColormapsList();

  constructor(
    private cornerstoneService: CornerstoneService,
    private metadataService: ImageMetadataService
  ) {
    (window as any).app = this;
  }

  readonly defaultTool = ToolName.Pan;
  enabledTool = ToolName.Pan;
  selectedColormap = CornerstoneColormap.hotIron;
  stackSize: number;
  stackPosition: number;
  lastRoiUuid?: string;
  importedImageIds: Map<string, Array<string>> = new Map();
  volumeStats?: {
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    std: number;
    meanLeft: number;
    meanRight: number;
    stdLeft: number;
    stdRight: number;
    areaLeft: number;
    areaRight: number;
    meanLeftOwn: number;
    meanRightOwn: number;
    stdLeftOwn: number;
    stdRightOwn: number;
  };

  imageDataLeft = new ImageData(() => this._dicomImageLeftElem.nativeElement, {
    isLeft: true,
  });
  imageDataRight = new ImageData(
    () => this._dicomImageRightElem.nativeElement,
    { isLeft: false }
  );
  selectedSide: ImageData;

  get allLoaded(): boolean {
    (window as any).dataL = this.imageDataLeft;
    (window as any).dataR = this.imageDataRight;
    return this.imageDataLeft.loaded && this.imageDataRight.loaded;
  }

  // METADATA

  currentInfoView: InfoView = InfoView.Metadata;

  selectedHistogram: HistogramType = HistogramType.dist;
  selectedHistogramRegion: HistogramRegion = HistogramRegion.lastRoi;
  isLeftSelected = true;
  get selectedMetadata(): ParsingResult | undefined {
    return this.isLeftSelected
      ? this.imageDataLeft.parsingResult
      : this.imageDataRight.parsingResult;
  }
  metadataFilter = '';
  noMatchesForFilter = false;

  @ViewChild('dicomImageLeft') _dicomImageLeftElem: ElementRef<HTMLDivElement>;
  @ViewChild('dicomImageRight')
  _dicomImageRightElem: ElementRef<HTMLDivElement>;
  @ViewChild('canvasComp') _canvasCompElem: ElementRef<HTMLCanvasElement>;

  get canvasElem(): HTMLCanvasElement {
    return this._canvasCompElem?.nativeElement;
  }

  changeImage = (selectElem: HTMLSelectElement, imageData: ImageData) => {
    if (selectElem.value === 'IMPORT') {
      selectElem.value = imageData.imageId;
      const _elemId = `fileInput${
        imageData === this.imageDataLeft ? 'Left' : 'Right'
      }`;
      document.getElementById(_elemId).click();
    } else if (selectElem.value !== imageData.imageId) {
      const imageIds = this.importedImageIds.get(selectElem.value);
      this.loadAndViewImages(selectElem.value, imageIds, imageData, false);
    }
  };

  changeColormap = (colormapId: CornerstoneColormap) => {
    this.selectedColormap = colormapId;
    if (this.allLoaded) {
      for (const { getElement, overlayLayerId: layerId } of [
        this.imageDataLeft,
        this.imageDataRight,
      ]) {
        const layer = cornerstone.getLayer(getElement(), layerId);

        const colormap = cornerstone.colors.getColormap(this.selectedColormap);
        colormap.setColor(0, [0, 0, 0, 0]);

        layer.viewport.colormap = colormap;
        cornerstone.updateImage(getElement(), true);
      }
    }
  };

  updateLayerOpacity = (opacity: number, imageData: ImageData) => {
    imageData.opacity = opacity;
    if (this.allLoaded) {
      const layer = cornerstone.getLayer(
        imageData.getElement(),
        imageData.overlayLayerId
      );

      layer.options.opacity = imageData.opacity;
      cornerstone.updateImage(imageData.getElement());
    }
  };

  updateLayerVisibility = (imageData: ImageData) => {
    imageData.visible = !imageData.visible;
    this.synchronizeRoiPoints(imageData);
    cornerstone.updateImage(imageData.getElement());
  };

  updateRoiSynchronization = (imageData: ImageData) => {
    imageData.synchronized = !imageData.synchronized;
  };

  _drawRoiInCanvas = (targetPixels: Array<number>, targetBBox: BBox) => {
    const canvas = this.canvasElem;
    if (canvas === undefined) {
      return;
    }
    const ctx = canvas.getContext('2d');
    const CELL_SIZE = 1;

    const maxValue = targetPixels.reduce((m, c) => Math.max(m, c), 0);
    const minValue = targetPixels.reduce(
      (m, c) => Math.min(m, c),
      Number.MAX_VALUE
    );
    console.log(minValue);
    console.log(maxValue);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.fillStyle = '#CCCCCC';

    for (let row = 0; row < targetBBox.height; row++) {
      for (let col = 0; col < targetBBox.width; col++) {
        const index = row * targetBBox.width + col;
        // ctx.fillStyle = cells[index] == Cell.Dead ? DEAD_COLOR : ALIVE_COLOR;
        const opacity = Math.floor(
          ((maxValue - (targetPixels[index] - minValue)) * 254) /
            (maxValue - minValue)
        );
        if (isNaN(opacity)) {
          console.log(
            ((maxValue - (targetPixels[index] - minValue)) * 254) /
              (maxValue - minValue)
          );
          console.log(targetPixels[index]);
        }

        ctx.fillStyle = '#000000' + opacity.toString(16);
        ctx.fillRect(
          col * CELL_SIZE * 2,
          row * CELL_SIZE,
          CELL_SIZE * 2,
          CELL_SIZE
        );
      }
    }
    ctx.stroke();
  };

  _didChangeRoi = (data: RoiData, element: HTMLElement): boolean => {
    let imageData: ImageData;
    if (element.id === this.imageDataLeft.getElement().id) {
      imageData = this.imageDataLeft;
    } else {
      imageData = this.imageDataRight;
    }
    data.visible = imageData.visible;

    const stackIndex = imageData.currentStackIndex();
    const stackPoints = imageData.currentStackPoints(stackIndex);

    if (
      !!stackPoints &&
      !!stackPoints[data.uuid] &&
      roisAreEqual(stackPoints[data.uuid].points, data.handles.points)
    ) {
      return false;
    }
    return true;
  };

  _onRoiEdited = (data: RoiData, element: HTMLElement): boolean => {
    let imageData: ImageData;
    if (element.id === this.imageDataLeft.getElement().id) {
      imageData = this.imageDataLeft;
    } else {
      imageData = this.imageDataRight;
    }
    data.visible = imageData.visible;

    if (!this._didChangeRoi(data, element)) {
      return false;
    }
    const _tool = cornerstoneTools.getToolForElement(
      element,
      ToolName.FreehandRoi
    );
    const _image = cornerstone.getImage(element);
    (_tool as any).updateCachedStats(_image, element, data);

    this.lastRoiUuid = data.uuid;
    const stackIndex = imageData.currentStackIndex();
    imageData.setPoints(stackIndex, data);
    this.selectedSide = imageData;

    cornerstone.updateImage(imageData.getElement(), true);
    return true;
  };

  drawHistogram = (points: DiffPoint[]): void => {
    const data = [
      ...points.map((p) => ({
        intensity: p.left,
        type: 'Left',
      })),
      ...points.map((p) => ({
        intensity: p.right,
        type: 'Right',
      })),
    ];

    const specDist: VisualizationSpec = {
      width: 600,
      height: 180,
      data: {
        values: data,
      },
      mark: 'bar',
      transform: [
        { bin: true, field: 'intensity', as: 'Binned', groupby: ['type'] },
        {
          aggregate: [{ op: 'count', field: 'Binned', as: 'Count' }],
          groupby: ['type', 'Binned', 'Binned_end'],
        },
        {
          joinaggregate: [{ op: 'sum', field: 'Count', as: 'TotalCount' }],
          groupby: ['type'],
        },
        {
          calculate: 'datum.Count/datum.TotalCount',
          as: 'RelativeCount',
          groupby: ['type'],
        },
      ],
      encoding: {
        x: {
          bin: { binned: true },
          field: 'Binned',
          type: 'quantitative',
          axis: {
            title: 'Intensity',
          },
        },
        x2: {
          field: 'Binned_end',
        },
        y: {
          field: 'RelativeCount',
          type: 'quantitative',
          axis: {
            title: 'Percentage',
          },
        },
        color: {
          field: 'type',
          scale: { range: ['#675193', '#ca8861'] },
          legend: { orient: 'bottom' },
        },
        opacity: { value: 0.6 },
      },
    };

    embed('#distChart', specDist);

    const specDiff: VisualizationSpec = {
      width: 600,
      height: 180,
      data: {
        values: points.map((p) => ({
          delta: p.diff,
        })),
      },
      mark: 'bar',
      encoding: {
        x: {
          field: 'delta',
          bin: true,
          axis: {
            title: 'Intensity Difference (Left - Right)',
          },
        },
        y: {
          aggregate: 'count',
          stack: null,
          axis: {
            title: 'Pixel Count',
          },
        },
      },
    };

    embed('#diffChart', specDiff);
  };

  uploadFile = (fileList: FileList, data: ImageData): void => {
    const files: File[] = [];
    console.log(fileList);
    // tslint:disable-next-line prefer-for-of
    for (let index = 0; index < fileList.length; index++) {
      const file = fileList[index];
      files.push(file);
    }
    if (files.length > 0) {
      let firstFileName: string;
      const imageIds: string[] = files.map((file, index) => {
        if (index === 0) {
          firstFileName = file.name;
        }
        if (file.type === 'application/x-gzip') {
          const url = URL.createObjectURL(file);
          const imageId = `nifti:${url}`;
          return imageId;
        }
        return cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
      });
      this.loadAndViewImages(firstFileName, imageIds, data, true);
    }
  };

  clearTool = (histogramRegion: HistogramRegion): void => {
    for (const data of [this.imageDataLeft, this.imageDataRight]) {
      if (data.removeData(histogramRegion, this.lastRoiUuid)) {
        this.synchronizeRoiPoints(data);
      }
    }
    this.imageDataLeft.getElement().click();
  };

  toggleTool = (toolName: ToolName): void => {
    if (this.imageDataLeft.loaded || this.imageDataRight.loaded) {
      if (this.enabledTool !== toolName) {
        this.enabledTool = toolName;
        cornerstoneTools.setToolActive(toolName, { mouseButtonMask: 1 });
        cornerstoneTools.setToolActive(this.defaultTool, {
          mouseButtonMask: 4,
        });
      } else {
        this.enabledTool = this.defaultTool;

        cornerstoneTools.setToolPassive(toolName, { mouseButtonMask: 1 });
        cornerstoneTools.setToolActive(this.defaultTool, {
          mouseButtonMask: 1,
        });
        cornerstoneTools.setToolActive(ToolName.Wwwc, {
          mouseButtonMask: 4,
        });
      }
    }
  };

  otherData = (data: ImageData) =>
    data === this.imageDataLeft ? this.imageDataRight : this.imageDataLeft;

  loadAndViewImages = async (
    fileName: string,
    imageIds: Array<string>,
    data: ImageData,
    isNewImport: boolean
  ): Promise<void> => {
    // if (data.loaded){
    //   data.getElement().hidden = false;
    // }
    if (!data.loaded) {
      data.loading = true;
    }

    const _images = (
      await Promise.all(
        imageIds.map((id) =>
          cornerstone.loadImage(id).catch<undefined>((e: any) => {
            console.log(e);
            return undefined;
          })
        )
      )
    ).filter((im) => im !== undefined);
    console.log(_images);

    let stack: { currentImageIdIndex: number; imageIds: string[] };
    let firstImage: CornerstoneImage;

    if (!imageIds[0].startsWith('nifti:')) {
      const images = _images
        .map((im) => ({
          image: im,
          metadata: this.metadataService.getDicomSummary(im.data),
        }))
        .sort((a, b) => a.metadata.instanceId - b.metadata.instanceId);
      firstImage = images[0].image;
      const info = images[0].metadata.info;
      data.parsingResult = {
        info,
        warnings: images[0].image.data.warnings,
        filteredInfo: info,
      };
      stack = {
        currentImageIdIndex: 0,
        imageIds: images.map((im) => im.image.imageId),
      };
    } else {
      firstImage = _images[0];
      const imageId = _images[0].imageId;
      const imageIdObject = cornerstoneNIFTIImageLoader.nifti.ImageId.fromURL(
        imageId
      );
      const info = this.metadataService.getNiftiSummary(imageId);
      data.parsingResult = {
        info,
        warnings: [],
        filteredInfo: info,
      };
      const numberOfSlices = cornerstone.metaData.get(
        'multiFrameModule',
        imageIdObject.url
      ).numberOfFrames;
      stack = {
        currentImageIdIndex: 0,
        imageIds: Array.from(
          Array(numberOfSlices),
          (_, i) =>
            `nifti:${imageIdObject.filePath}#${imageIdObject.slice.dimension}-${i}`
        ),
      };
    }

    const element = data.getElement();
    data.loaded = true;
    this._setUpTools(element);

    if (data.layerId !== undefined) {
      cornerstone.removeLayer(element, data.layerId);
      cornerstone.removeLayer(element, data.overlayLayerId);
      cornerstoneTools.clearToolState(element, 'stack');
    } else {
      cornerstoneTools.addStackStateManager(element, ['stack']);
    }
    if (this.allLoaded) {
      stack.currentImageIdIndex = this.otherData(data).currentStackIndex();
    }
    cornerstoneTools.addToolState(element, 'stack', stack);
    this.stackPosition = stack.currentImageIdIndex;
    this.stackSize = stack.imageIds.length;
    data.layerId = cornerstone.addLayer(element, firstImage, { opacity: 1 });

    // const _imageId = (firstImage.imageId.startsWith('nifti')
    //   ? fileName
    //   : firstImage.imageId
    // ).substring(0, 14);
    if (isNewImport) {
      data.imageId = fileName;
      let _i = 1;
      while (this.importedImageIds.has(data.imageId)) {
        data.imageId = fileName + _i++;
      }
      this.importedImageIds.set(data.imageId, stack.imageIds);
    }
    console.log(firstImage);

    data.dynamicImage = {
      imageId: data.getElement().id,
      minPixelValue: 0,
      maxPixelValue: 255,
      slope: 1.0,
      intercept: 0,
      windowCenter: firstImage.width / 2,
      windowWidth: firstImage.width,
      getPixelData: this.createGetPixelData(data),
      rows: firstImage.rows,
      columns: firstImage.columns,
      render: cornerstone.renderGrayscaleImage,
      height: firstImage.height,
      width: firstImage.width,
      color: false,
      columnPixelSpacing: firstImage.columnPixelSpacing,
      rowPixelSpacing: firstImage.rowPixelSpacing,
      invert: false,
      sizeInBytes: firstImage.height * firstImage.width,
      data: {
        rawPixels: new Uint8Array(firstImage.height * firstImage.width),
      },
    };
    const colormap = cornerstone.colors.getColormap(this.selectedColormap);
    colormap.setColor(0, [0, 0, 0, 0]);

    data.overlayLayerId = cornerstone.addLayer(element, data.dynamicImage, {
      opacity: data.opacity,
      viewport: {
        colormap,
      },
    });

    this.toggleTool(ToolName.FreehandRoi);
    this.toggleTool(ToolName.FreehandRoi);
    if (this.allLoaded) {
      cornerstoneTools.clearToolState(element, ToolName.FreehandRoi);
      this.otherData(data).getElement().click();
    }
    for (const { loaded, getElement } of [
      this.imageDataLeft,
      this.imageDataRight,
    ]) {
      if (loaded) {
        cornerstone.updateImage(getElement(), true);
      }
    }

    element.addEventListener(
      cornerstoneTools.EVENTS.STACK_SCROLL,
      async (e) => {
        const eDetail = (e as any).detail as {
          newImageIdIndex: number;
          direction: 1 | -1;
        };
        this.stackPosition = eDetail.newImageIdIndex;

        if ([this.imageDataLeft, this.imageDataRight].every((d) => d.loaded)) {
          let retries = 0;
          while (
            retries < 5 &&
            this.imageDataLeft.currentStackIndex() !==
              this.imageDataRight.currentStackIndex()
          ) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            retries++;
          }
        }

        for (const d of [this.imageDataLeft, this.imageDataRight]) {
          if (!d.loaded || eDetail.newImageIdIndex !== d.currentStackIndex()) {
            return;
          }
          const stackPointCurr = d.currentStackPoints(eDetail.newImageIdIndex);
          const elem = d.getElement();
          const shouldUpdate = this.synchronizeRoiPoints(d);
          cornerstone.updateImage(elem, true);
          // if (
          //   shouldUpdate ||
          //   !!stackPointCurr ||
          //   !!d.currentStackPoints(eDetail.newImageIdIndex - eDetail.direction)
          // ) {
          //   cornerstone.updateImage(elem, true);
          // }
        }
      }
    );
    setTimeout(() => {
      const syncProps = cornerstone.getLayer(element, data.overlayLayerId)
        .syncProps;
      if (!!syncProps) {
        syncProps.originalScale = cornerstone.getLayer(
          element,
          data.layerId
        ).syncProps?.originalScale;
        cornerstone.updateImage(element);
      }
    }, 10);

    data.loading = false;
  };

  synchronizeRoiPoints = (data: ImageData): boolean => {
    const elem = data.getElement();
    const stackPointCurr = data.currentStackPoints() ?? {};
    const state = cornerstoneTools.getToolState(elem, ToolName.FreehandRoi) ?? {
      data: [],
    };
    const cornerstonData = state.data as RoiData[];
    if (cornerstonData.length > Object.keys(stackPointCurr).length) {
      cornerstoneTools.clearToolState(elem, ToolName.FreehandRoi);
    }
    const map = cornerstonData.reduce((previous, current) => {
      previous.set(current.uuid, current);
      return previous;
    }, new Map<string, RoiData>());

    let result = false;
    Object.entries(stackPointCurr).map(([key, { points: value }]) => {
      if (!map.has(key)) {
        result = true;
        cornerstoneTools.addToolState(
          elem,
          ToolName.FreehandRoi,
          this.cornerstoneService.createRoiData(key, value, data.visible)
        );
      } else {
        const d = map.get(key);
        d.handles.points.forEach((p, index) => {
          result = result || p.x !== value[index].x || p.y !== value[index].y;
          p.x = value[index].x;
          p.y = value[index].y;
        });
        result = result || d.visible !== data.visible;
        d.visible = data.visible;
      }
    });
    if (result) {
      const element = data.getElement();
      const _tool = cornerstoneTools.getToolForElement(
        element,
        ToolName.FreehandRoi
      );
      const _image = cornerstone.getImage(element);
      for (const d of cornerstoneTools.getToolState(elem, ToolName.FreehandRoi)
        ?.data ?? []) {
        (_tool as any).updateCachedStats(_image, element, d);
      }
    }
    return result;
  };

  createGetPixelData = (data: ImageData): (() => number[]) => {
    return () => {
      const _curr = data.currentStackPoints();
      const dataList = data.getRoiPixels();
      if (dataList.length === 0) {
        return data.dynamicImage.data.rawPixels;
      }
      const rawPixels = new Uint8Array(
        data.dynamicImage.height * data.dynamicImage.width
      );
      const otherData = this.otherData(data);

      for (let i = 0; i < dataList.length; i++) {
        const roi = dataList[i];
        let diffData: DiffData = _curr[roi.uuid].diffData;

        if (
          diffData?.imageId !== this.imageDataLeft.imageId ||
          !roisAreEqual(diffData?.points, roi.points)
        ) {
          // TODO: different scale?
          const otherPixels = cornerstone.getPixels(
            otherData.getElement(),
            roi.bbox.left,
            roi.bbox.top,
            roi.bbox.width,
            roi.bbox.height
          );

          let left: number[];
          let right: number[];
          if (data.isLeft) {
            left = roi.pixels;
            right = otherPixels;
          } else {
            right = roi.pixels;
            left = otherPixels;
          }
          const bbox = roi.bbox;

          let index = 0;
          const differencePixels: Array<DiffPoint> = [];
          let maxDiff = Number.MIN_VALUE;
          let minDiff = Number.MAX_VALUE;
          let sumDiff = 0;
          for (let y = bbox.top; y < bbox.top + bbox.height; y++) {
            for (let x = bbox.left; x < bbox.left + bbox.width; x++) {
              const inFreehand = this.cornerstoneService.pointInFreehand2(
                roi.points,
                { x, y },
                bbox
              );
              if (inFreehand) {
                const diff = left[index] - right[index];
                if (isNaN(diff)) {
                  console.log(
                    x,
                    y,
                    index,
                    left[index],
                    right[index],
                    left.length,
                    right.length
                  );
                }
                maxDiff = Math.max(maxDiff, diff);
                minDiff = Math.min(minDiff, diff);
                sumDiff += diff;
                const xInt = Math.round(x);
                const yInt = Math.round(y);

                differencePixels.push({
                  left: left[index],
                  right: right[index],
                  index: yInt * data.dynamicImage.width + xInt,
                  diff,
                  x: xInt,
                  y: yInt,
                });
              }
              index++;
            }
          }
          diffData = {
            array: differencePixels,
            max: maxDiff,
            min: minDiff,
            sum: sumDiff,
            points: roi.points.map((p) => ({ ...p })),
            imageId: data.imageId,
          };
          data.currentStackPoints()[roi.uuid].diffData = diffData;

          // TODO: cache in other side
          // this.imageDataRight.currentStackPoints()[
          //   rightData.uuid
          // ].diffData = {
          //   ...diffData,
          //   points: rightData.points.map((p) => ({ ...p })),
          //   imageId: this.imageDataRight.imageId,
          // };
        }

        for (const p of diffData.array) {
          const value = Math.floor(
            ((p.diff - diffData.min) / (diffData.max - diffData.min)) * 255
          );
          rawPixels[p.index] = value;
        }
      }
      setTimeout(this.updateVolumeStats, 10);

      return rawPixels as any;
    };
  };

  updateVolumeStats = () => {
    const difListLeft = this.imageDataLeft.getData(
      this.selectedHistogramRegion,
      this.lastRoiUuid
    );
    const difListRight = this.imageDataRight.getData(
      this.selectedHistogramRegion,
      this.lastRoiUuid
    );
    if (difListLeft.length === 0 && difListRight.length === 0) {
      return;
    }

    let _baseDiffPoints: DiffPoint[];
    let _isOnlySide: null | 'left' | 'right' = null;
    if (this.selectedHistogramRegion === HistogramRegion.lastRoi) {
      if (this.selectedSide.isLeft) {
        _baseDiffPoints = difListLeft.flatMap((p) => p.diffData.array);
        _isOnlySide = 'left';
      } else {
        _baseDiffPoints = difListRight.flatMap((p) => p.diffData.array);
        _isOnlySide = 'right';
      }
    } else {
      _baseDiffPoints = difListLeft
        .flatMap((p) => p.diffData.array)
        .concat(difListRight.flatMap((p) => p.diffData.array));
    }

    const diffPoints = [
      ..._baseDiffPoints
        .reduce((m, p) => {
          m.set(`${p.x}_${p.y}`, p);
          return m;
        }, new Map<string, DiffPoint>())
        .values(),
    ];
    this.drawHistogram(diffPoints);

    const stats = diffPoints.reduce(
      (previous, p) => {
        previous.sumLeft += p.left;
        previous.sumRight += p.right;
        previous.sumDiff += p.diff;

        previous.minLeft = Math.min(previous.minLeft, p.left);
        previous.maxLeft = Math.max(previous.maxLeft, p.left);
        previous.minRight = Math.min(previous.minRight, p.right);
        previous.maxRight = Math.max(previous.maxRight, p.right);
        previous.minDiff = Math.min(previous.minDiff, p.diff);
        previous.maxDiff = Math.max(previous.maxDiff, p.diff);
        return previous;
      },
      {
        sumDiff: 0,
        sumLeft: 0,
        sumRight: 0,
        minLeft: Number.MAX_VALUE,
        maxLeft: Number.MIN_VALUE,
        minRight: Number.MAX_VALUE,
        maxRight: Number.MIN_VALUE,
        minDiff: Number.MAX_VALUE,
        maxDiff: Number.MIN_VALUE,
      }
    );
    const diffMean = stats.sumDiff / diffPoints.length;
    const leftMean = stats.sumLeft / diffPoints.length;
    const rightMean = stats.sumRight / diffPoints.length;

    const diffVariance = diffPoints.reduce(
      (previous, p) => {
        previous.diff += Math.pow(p.diff - diffMean, 2);
        previous.left += Math.pow(p.left - leftMean, 2);
        previous.right += Math.pow(p.right - rightMean, 2);
        return previous;
      },
      { left: 0, right: 0, diff: 0 }
    );

    const _sideStats = (data: ImageData) => {
      return data
        .getData(this.selectedHistogramRegion, this.lastRoiUuid)
        .reduce(
          (previous, { stats }) => {
            previous.sum += stats.mean * stats.count;
            previous.count += stats.count;
            previous.varianceSum += stats.variance * stats.count;
            previous.area += stats.area;
            return previous;
          },
          {
            count: 0,
            sum: 0,
            varianceSum: 0,
            area: 0,
          }
        );
    };
    const statsLeft = _sideStats(this.imageDataLeft);
    const statsRight = _sideStats(this.imageDataRight);

    const toStr = (v: number) => Number.parseFloat(v.toFixed(1));

    if (diffPoints.length > 0) {
      this.volumeStats = {
        ...stats,

        count: diffPoints.length,
        max: stats.maxDiff,
        min: stats.minDiff,
        sum: stats.sumDiff,

        //
        mean: toStr(diffMean),
        std: toStr(Math.sqrt(diffVariance.diff / diffPoints.length)),
        //
        meanLeft: toStr(leftMean),
        stdLeft: toStr(Math.sqrt(diffVariance.left / diffPoints.length)),
        //
        meanRight: toStr(rightMean),
        stdRight: toStr(Math.sqrt(diffVariance.right / diffPoints.length)),

        //
        areaLeft:
          _isOnlySide === 'right'
            ? toStr(statsRight.area)
            : toStr(statsLeft.area),
        areaRight:
          _isOnlySide === 'left'
            ? toStr(statsLeft.area)
            : toStr(statsRight.area),

        //
        meanLeftOwn: toStr(statsLeft.sum / statsLeft.count),
        stdLeftOwn: toStr(Math.sqrt(statsLeft.varianceSum / statsLeft.count)),
        //
        meanRightOwn: toStr(statsRight.sum / statsRight.count),
        stdRightOwn: toStr(
          Math.sqrt(statsRight.varianceSum / statsRight.count)
        ),
      };
    }
  };

  shouldSynchronizeRoi = (): boolean => {
    return this.imageDataRight.synchronized;
  };

  _setUpTools = (element: HTMLDivElement): void => {
    cornerstone.enable(element);

    if (this.allLoaded) {
      const synchronizer: Synchronizer = new cornerstoneTools.Synchronizer(
        cornerstone.EVENTS.IMAGE_RENDERED,
        this.cornerstoneService.panZoomSynchronizer
      );
      const synchronizerStack = new cornerstoneTools.Synchronizer(
        cornerstone.EVENTS.IMAGE_RENDERED,
        cornerstoneTools.stackImageIndexSynchronizer
      );

      const synchronizerFreehandRoi = new cornerstoneTools.Synchronizer(
        `click`,
        this.cornerstoneService.freehandRoiSynchronizer({
          onUpdateCompleted: this._onRoiEdited,
          didChangeRoi: this._didChangeRoi,
          getImageVisibility: (d) =>
            // true
            this.imageDataLeft.getElement() === d
              ? this.imageDataLeft.visible
              : this.imageDataRight.visible,
          shouldSynchronize: this.shouldSynchronizeRoi,
        })
      );

      for (const data of [this.imageDataLeft, this.imageDataRight]) {
        const el = data.getElement();
        synchronizer.add(el);
        synchronizerStack.add(el);
        synchronizerFreehandRoi.add(el);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            (cornerstoneTools.getToolForElement(
              el,
              ToolName.FreehandRoi
            ) as any).cancelDrawing(el);
            const other = this.otherData(data);
            const otherRois: RoiData[] = cornerstoneTools.getToolState(
              other.getElement(),
              ToolName.FreehandRoi
            )?.data;
            for (const roi of otherRois) {
              if (roi.area === undefined) {
                cornerstoneTools.removeToolState(
                  other.getElement(),
                  ToolName.FreehandRoi,
                  roi
                );
              }
            }
            cornerstone.updateImage(other.getElement());
            cornerstone.updateImage(el);
            // this.cornerstoneService.syncronize(
            //   {
            //     onUpdateCompleted: (_) => true,
            //     getImageVisibility: (d) => true,
            //     didChangeRoi: () => true,
            //     shouldSynchronize: this.shouldSynchronizeRoi,
            //   },
            //   el,
            //   this.otherData(data).getElement()
            // );
          }
        });
      }

      (window as any).synchronizer = synchronizer;

      this.configureTools([
        {
          name: ToolName.Pan,
          options: {
            mouseButtonMask: 1,
            synchronizationContext: synchronizer,
          },
        },
        {
          name: ToolName.Zoom,
          options: {
            mouseButtonMask: 2,
            synchronizationContext: synchronizer,
          },
        },
        {
          name: ToolName.StackScrollMouseWheel,
          options: {
            synchronizationContext: synchronizerStack,
          },
        },
        {
          name: ToolName.FreehandRoi,
          options: {
            synchronizationContext: synchronizerFreehandRoi,
          },
        },
      ]);
    }

    const _toolsData = [
      { name: ToolName.Pan, options: { mouseButtonMask: 1 } },
      { name: ToolName.Zoom, options: { mouseButtonMask: 2 } },
      { name: ToolName.Wwwc, options: { mouseButtonMask: 4 } },
      { name: ToolName.StackScrollMouseWheel, options: {} },
      { name: ToolName.Probe, options: {}, active: false },
      { name: ToolName.FreehandRoi, options: {}, active: false },
    ];

    this.configureTools(_toolsData);
  };

  configureTools = (
    configs: {
      name: ToolName;
      options?: object;
      active?: boolean;
    }[]
  ): void => {
    for (const config of configs) {
      const tool = getToolFromName(config.name);
      cornerstoneTools.addTool(tool);
      if (config.active ?? true) {
        cornerstoneTools.setToolActive(config.name, config.options ?? {});
      }
    }
  };

  selectMetadata = (isLeft: boolean) => {
    this.isLeftSelected = isLeft;
    this._updateMetadata();
  };

  selectHistogram = (histType: HistogramType) => {
    this.selectedHistogram = histType;
  };
  selectHistogramRegion = (histRegion: HistogramRegion) => {
    this.selectedHistogramRegion = histRegion;
    this.updateVolumeStats();
  };

  onSearchInput = (inputStr: string) => {
    this.metadataFilter = inputStr.toLowerCase();
    this._updateMetadata();
  };

  private _updateMetadata = () => {
    if (
      this.selectedMetadata !== undefined &&
      'info' in this.selectedMetadata
    ) {
      this.selectedMetadata.filteredInfo = Object.entries(
        this.selectedMetadata.info
      )
        .filter(
          ([key, value]) =>
            key.toLowerCase().includes(this.metadataFilter) ||
            value.toLowerCase().includes(this.metadataFilter)
        )
        .reduce((p, [key, value]) => {
          p[key] = value;
          return p;
        }, {});
      this.noMatchesForFilter =
        Object.keys(this.selectedMetadata.filteredInfo).length === 0;
    }
  };
}

// const leftMap = difListLeft.reduce((set, value) => {
//   set.set(value.uuid, value);
//   return set;
// }, new Map<string, ImageStackData>());
// const rightMap = difListRight.reduce((set, value) => {
//   set.set(value.uuid, value);
//   const leftValue = leftMap.get(value.uuid);
//   if (leftValue !== undefined) {
//     if (roisAreEqual(value.points, leftValue.points)) {
//       difList.push(value);
//     } else {
//       // TODO: diff
//     }
//   } else {
//     difList.push(value);
//   }
//   return set;
// }, new Map<string, ImageStackData>());

// leftMap.forEach((value, key) => {
//   const rightValue = rightMap.get(value.uuid);
//   if (rightValue === undefined) {
//     if (roisAreEqual(value.points, rightValue.points)) {
//     } else {
//       // TODO: diff
//     }
//   }
// });
