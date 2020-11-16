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
import { BBox, getBoundingBox } from './utils';

setWasmPaths(`./assets/`);
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

class ImageData {
  constructor(getElement: () => HTMLDivElement) {
    this.getElement = getElement;
  }

  loading = false;
  loaded = false;
  opacity = 0.7;
  parsingResult?: ParsingResult = undefined;
  getElement: () => HTMLDivElement;
  imageId?: string;

  dynamicImage?: CornerstoneImage;
  overlayLayerId?: string;
  layerId?: string;

  roiPointsByStack: Array<{ [key: string]: Array<Offset> }> = [];

  currentStackPoints = (
    stackIndex?: number
  ): { [key: string]: Array<Offset> } | undefined => {
    if (stackIndex === undefined) {
      const element = this.getElement();
      try {
        const stackState = cornerstoneTools.getToolState(
          element,
          'stack'
        ) as StackToolState;
        stackIndex = stackState.data[0].currentImageIdIndex;
      } catch (_) {
        return undefined;
      }
    }
    return this.roiPointsByStack[stackIndex];
  };

  clearData = () => {
    if (this.loaded) {
      this.roiPointsByStack = [];
      cornerstoneTools.clearToolState(this.getElement(), ToolName.FreehandRoi);
      cornerstone.updateImage(this.getElement(), true);
    }
  };

  setPoints = (
    stackIndex: number,
    uuid: string,
    points: Array<Offset>
  ): void => {
    let map = this.roiPointsByStack[stackIndex];
    if (!map) {
      map = {};
      this.roiPointsByStack[stackIndex] = map;
    }
    map[uuid] = points;
  };

  getRoiPixels = (): Array<{
    pixels: number[];
    bbox: BBox;
    points: Array<Offset>;
  }> => {
    const pointsMap = this.currentStackPoints();

    if (!pointsMap) {
      return [];
    }

    return Object.values(pointsMap).map((points) => {
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
      };
    });
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

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  ToolName = ToolName;
  InfoView = InfoView;
  HistogramType = HistogramType;
  colormaps = cornerstone.colors.getColormapsList();

  constructor(
    private cornerstoneService: CornerstoneService,
    private metadataService: ImageMetadataService
  ) {}

  readonly defaultTool = ToolName.Pan;
  enabledTool = ToolName.Pan;
  selectedColormap = CornerstoneColormap.hotIron;

  importedImageIds: Map<string, Array<string>> = new Map();

  imageDataLeft = new ImageData(() => this._dicomImageLeftElem.nativeElement);
  imageDataRight = new ImageData(() => this._dicomImageRightElem.nativeElement);

  get allLoaded(): boolean {
    (window as any).dataL = this.imageDataLeft;
    (window as any).dataR = this.imageDataRight;
    return this.imageDataLeft.loaded && this.imageDataRight.loaded;
  }

  // METADATA

  currentInfoView: InfoView = InfoView.Metadata;

  selectedHistogram: HistogramType = HistogramType.dist;
  isLeftSelected = true;
  get selectedMetadata(): ParsingResult | undefined {
    return this.isLeftSelected
      ? this.imageDataLeft.parsingResult
      : this.imageDataRight.parsingResult;
  }
  metadataFilter = '';
  noMatchesForFilter = false;

  @ViewChild('dicomImageLeft') _dicomImageLeftElem: ElementRef<HTMLDivElement>;
  @ViewChild('dicomImageRight') _dicomImageRightElem: ElementRef<
    HTMLDivElement
  >;
  @ViewChild('canvasComp') _canvasCompElem: ElementRef<HTMLCanvasElement>;

  get canvasElem(): HTMLCanvasElement {
    return this._canvasCompElem?.nativeElement;
  }

  changeImage = (importedImageId: string, imageData: ImageData) => {
    const imageIds = this.importedImageIds.get(importedImageId);
    this.loadAndViewImages(imageIds, imageData);
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

  drawCompCanvas = (
    target: RoiData & { element: HTMLElement },
    source: RoiData & { element: HTMLElement }
  ) => {
    console.log(target);
    const polyBoundingBox = target.polyBoundingBox;
    const targetBBox = getBoundingBox(target.handles.points);
    const targetPixels = cornerstone.getPixels(
      target.element,
      targetBBox.left,
      targetBBox.top,
      targetBBox.width,
      targetBBox.height
    );

    console.log(polyBoundingBox);
    console.log(targetBBox.width);
    console.log(targetBBox.height);

    this._drawRoiInCanvas(targetPixels, targetBBox);

    const sourceBBox = getBoundingBox(source.handles.points);
    const sourcePixels = cornerstone.getPixels(
      source.element,
      sourceBBox.left,
      sourceBBox.top,
      sourceBBox.width,
      sourceBBox.height
    );

    const stackState = cornerstoneTools.getToolState(
      source.element,
      'stack'
    ) as StackToolState;
    const stackIndex = stackState.data[0].currentImageIdIndex;

    if (target.element.id === this.imageDataLeft.getElement().id) {
      this.imageDataRight.setPoints(
        stackIndex,
        source.uuid,
        source.handles.points
      );
      this.imageDataLeft.setPoints(
        stackIndex,
        target.uuid,
        target.handles.points
      );
      this.drawHistogram(targetPixels, sourcePixels);
    } else {
      this.imageDataRight.setPoints(
        stackIndex,
        target.uuid,
        target.handles.points
      );
      this.imageDataLeft.setPoints(
        stackIndex,
        source.uuid,
        source.handles.points
      );
      this.drawHistogram(sourcePixels, targetPixels);
    }
    cornerstone.updateImage(this.imageDataLeft.getElement(), true);
    cornerstone.updateImage(this.imageDataRight.getElement(), true);
  };

  drawHistogram = (leftPixels: number[], rightPixels: number[]): void => {
    const data = [
      ...leftPixels.map((p) => ({
        intensity: p,
        type: 'Left',
      })),
      ...rightPixels.map((p) => ({
        intensity: p,
        type: 'Right',
      })),
    ];

    const specDist: VisualizationSpec = {
      width: 600,
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
        x: { bin: { binned: true }, field: 'Binned', type: 'quantitative' },
        x2: {
          field: 'Binned_end',
        },
        y: {
          field: 'RelativeCount',
          type: 'quantitative',
        },
        color: {
          field: 'type',
          scale: { range: ['#675193', '#ca8861'] },
        },
        opacity: { value: 0.6 },
      },
    };

    embed('#distChart', specDist);

    const specDiff: VisualizationSpec = {
      width: 600,
      data: {
        values: leftPixels.map((p, index) => ({
          delta: p - rightPixels[index],
        })),
      },
      mark: 'bar',
      encoding: {
        x: { field: 'delta', bin: true },
        y: {
          aggregate: 'count',
          stack: null,
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
      const imageIds: string[] = files.map((file) => {
        if (file.type === 'application/x-gzip') {
          const url = URL.createObjectURL(file);
          const imageId = `nifti:${url}`;
          return imageId;
        }
        return cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
      });
      this.loadAndViewImages(imageIds, data);
    }
  };

  clearTool = (): void => {
    if (this.enabledTool !== this.defaultTool) {
      for (const data of [this.imageDataLeft, this.imageDataRight]) {
        data.clearData();
      }
    }
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

  loadAndViewImages = async (
    imageIds: Array<string>,
    data: ImageData
  ): Promise<void> => {
    data.loading = true;

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
      const previousStackState = cornerstoneTools.getToolState(
        element,
        'stack'
      ) as StackToolState;
      cornerstoneTools.removeToolState(
        element,
        'stack',
        previousStackState.data[0]
      );
    } else {
      cornerstoneTools.addStackStateManager(element, ['stack']);
    }
    cornerstoneTools.addToolState(element, 'stack', stack);
    this.importedImageIds.set(firstImage.imageId, stack.imageIds);
    data.imageId = firstImage.imageId;
    data.layerId = cornerstone.addLayer(element, firstImage, { opacity: 1 });

    // const viewport = cornerstone.getDefaultViewportForImage(
    //   element,
    //   firstImage
    // );
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
      sizeInBytes: firstImage.height * firstImage.width * 2,
      data: {
        rawPixels: new Uint16Array(firstImage.height * firstImage.width),
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
        await new Promise((resolve) => setTimeout(resolve, 50));

        for (const { getElement, currentStackPoints } of [
          this.imageDataLeft,
          this.imageDataRight,
        ]) {
          if (
            !!currentStackPoints(eDetail.newImageIdIndex) ||
            !!currentStackPoints(eDetail.newImageIdIndex - eDetail.direction)
          ) {
            cornerstone.updateImage(getElement(), true);
          }
        }
      }
    );

    data.loading = false;
  };

  createGetPixelData = (data: ImageData): (() => number[]) => {
    return () => {
      const image = data.dynamicImage;
      const rawPixels = new Uint16Array(
        data.dynamicImage.height * data.dynamicImage.width
      );

      const leftDataList = this.imageDataLeft.getRoiPixels();
      const rightDataList = this.imageDataRight.getRoiPixels();
      const numIterations = Math.min(leftDataList.length, rightDataList.length);
      console.log('createGetPixelData', numIterations);

      for (let i = 0; i < numIterations; i++) {
        const leftData = leftDataList[i];
        const right = rightDataList[i].pixels;
        const left = leftData.pixels;
        const bbox = leftData.bbox;
        console.log(left.length, right.length);
        console.log(leftDataList[i].bbox, rightDataList[i].bbox);

        let index = 0;
        const differencePixels: [number, number][] = [];
        let maxDiff = Number.MIN_VALUE;
        let minDiff = Number.MAX_VALUE;
        for (let y = bbox.top; y < bbox.top + bbox.height; y++) {
          for (let x = bbox.left; x < bbox.left + bbox.width; x++) {
            const inFreehand = this.cornerstoneService.pointInFreehand(
              leftData.points,
              { x, y }
            );
            if (inFreehand) {
              const diff = left[index] - right[index];
              if (isNaN(diff)) {
                console.log(x, y, index, left[index], right[index]);
              }
              maxDiff = Math.max(maxDiff, diff);
              minDiff = Math.min(minDiff, diff);
              differencePixels.push([
                Math.round(y) * data.dynamicImage.width + Math.round(x),
                diff,
              ]);
            }
            index++;
          }
        }
        for (const [ind, diff] of differencePixels) {
          const value = Math.floor(
            ((diff - minDiff) / (maxDiff - minDiff)) * 255
          );
          rawPixels[ind] = value;
        }
      }

      // for (const [ind, diff] of differencePixels) {
      //   const value = Math.floor(
      //     ((diff - minDiff) / (maxDiff - minDiff)) * 255
      //   );

      //   const rescaled = value * 3;
      //   rawPixels[ind * 4] = rescaled < 255 ? rescaled : 255;
      //   rawPixels[ind * 4 + 1] =
      //     rescaled > 255 ? (rescaled > 255 * 2 ? 255 : rescaled - 255) : 0;
      //   rawPixels[ind * 4 + 2] = rescaled > 255 * 2 ? rescaled - 255 * 2 : 0;
      //   rawPixels[ind * 4 + 3] = 255;
      // }

      return rawPixels as any;
    };
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
        'click keydown',
        this.cornerstoneService.freehandRoiSynchronizer({
          onUpdateCompleted: this.drawCompCanvas,
        })
      );

      for (const { getElement } of [this.imageDataLeft, this.imageDataRight]) {
        const el = getElement();
        synchronizer.add(el);
        synchronizerStack.add(el);
        synchronizerFreehandRoi.add(el);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            (cornerstoneTools.getToolForElement(
              el,
              ToolName.FreehandRoi
            ) as any).cancelDrawing(el);
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
