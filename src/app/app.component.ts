import { Component, ElementRef, ViewChild } from '@angular/core';
import * as dicomParser from 'dicom-parser';

import embed, { VisualizationSpec } from 'vega-embed';
import {
  CornerstoneImage,
  Offset,
  RoiData,
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
import { BBox, getBoundingBox, pointInBBox } from './utils';

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

type ImageData = {
  loading: boolean;
  loaded: boolean;
  parsingResult?: ParsingResult;
  getElement: () => HTMLDivElement;
  dynamicImage?: CornerstoneImage;
  layerId?: string;
  roiPoints: Offset[];
};

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

  constructor(
    private cornerstoneService: CornerstoneService,
    private metadataService: ImageMetadataService
  ) {}

  readonly defaultTool = ToolName.Pan;
  enabledTool = ToolName.Pan;

  imageDataLeft: ImageData = {
    loading: false,
    loaded: false,
    parsingResult: undefined,
    getElement: () => this._dicomImageLeftElem.nativeElement,
    roiPoints: [],
  };

  imageDataRight: ImageData = {
    loading: false,
    loaded: false,
    parsingResult: undefined,
    getElement: () => this._dicomImageRightElem.nativeElement,
    roiPoints: [],
  };

  get allLoaded(): boolean {
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

  drawDeltaMap = () => {
    const layers = [
      {
        imageId: 'ct://1',
      },
      {
        imageId: 'pet://1',
        options: {
          opacity: 0.7,
          viewport: {
            colormap: 'hotIron',
            voi: {
              windowWidth: 30,
              windowCenter: 16,
            },
          },
        },
      },
    ];
  };

  drawCompCanvas = (
    target: RoiData & { element: HTMLElement },
    source: RoiData & { element: HTMLElement }
  ) => {
    const canvas = this.canvasElem;
    if (canvas === undefined) {
      return;
    }

    const ctx = canvas.getContext('2d');
    console.log(target);
    const polyBoundingBox = target.polyBoundingBox;
    const { top, bottom, left, right, width, height } = getBoundingBox(
      target.handles.points
    );

    const CELL_SIZE = 1;

    const targetPixels = cornerstone.getPixels(
      target.element,
      left,
      top,
      width,
      height
    );
    console.log(targetPixels);
    console.log(polyBoundingBox);
    console.log(width);
    console.log(height);
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

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const index = row * width + col;
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

    const sourceBBox = getBoundingBox(source.handles.points);

    const sourcePixels = cornerstone.getPixels(
      source.element,
      sourceBBox.left,
      sourceBBox.top,
      sourceBBox.width,
      sourceBBox.height
    );

    if (target.element.id === this.imageDataLeft.getElement().id) {
      this.imageDataRight.roiPoints = source.handles.points;
      this.imageDataLeft.roiPoints = target.handles.points;

      cornerstone.updateImage(this.imageDataRight.getElement(), true);
      this.drawHistogram(targetPixels, sourcePixels);
    } else {
      this.imageDataRight.roiPoints = target.handles.points;
      this.imageDataLeft.roiPoints = source.handles.points;

      this.drawHistogram(sourcePixels, targetPixels);
    }
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
      this.loadAndViewImages(files, data);
    }
  };

  clearTool = (): void => {
    if (this.enabledTool !== this.defaultTool) {
      for (const data of [this.imageDataLeft, this.imageDataRight]) {
        if (this.imageDataLeft.loaded) {
          cornerstoneTools.clearToolState(data.getElement(), this.enabledTool);
          cornerstone.updateImage(data.getElement());
        }
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
        console.log([
          ...cornerstoneTools.getToolState(
            this.imageDataLeft.getElement(),
            toolName
          ).data,
        ]);
        // this.clearTool();
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

  loadAndViewImages = async (files: File[], data: ImageData): Promise<void> => {
    data.loading = true;
    const imageIds: string[] = files.map((file) => {
      if (file.type === 'application/x-gzip') {
        const url = URL.createObjectURL(file);
        const imageId = `nifti:${url}`;
        return imageId;
      }
      return cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
    });

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
    if (!data.loaded) {
      data.loaded = true;
      this._setUpTools(element);
    }

    // const viewport = cornerstone.getDefaultViewportForImage(
    //   element,
    //   firstImage
    // );
    console.log(firstImage);
    cornerstone.addLayer(element, firstImage, {});

    if (this.allLoaded) {
      data.dynamicImage = {
        imageId: 'notneeded',
        minPixelValue: 0,
        maxPixelValue: 255,
        slope: 1.0,
        intercept: 0,
        windowCenter: firstImage.width / 2,
        windowWidth: firstImage.width,
        getPixelData: this.createGetPixelData(data),
        rows: firstImage.rows,
        columns: firstImage.columns,
        height: firstImage.height,
        width: firstImage.width,
        color: false,
        columnPixelSpacing: firstImage.columnPixelSpacing,
        rowPixelSpacing: firstImage.rowPixelSpacing,
        invert: false,
        sizeInBytes: firstImage.height * firstImage.width * 2,
        data: {
          opacity: 0.5,
          rawPixels: new Uint16Array(firstImage.height * firstImage.width),
        },
      };
      data.layerId = cornerstone.addLayer(element, data.dynamicImage, {
        opacity: 0.7,
        viewport: {
          colormap: 'hotIron',
          voi: {
            windowWidth: 30,
            windowCenter: 16,
          },
        },
      });
    }

    cornerstoneTools.addStackStateManager(element, ['stack']);
    cornerstoneTools.addToolState(element, 'stack', stack);
    cornerstone.updateImage(element);

    data.loading = false;
  };

  createGetPixelData = (data: ImageData): (() => number[]) => {
    return () => {
      const image = data.dynamicImage;
      const rawPixels = image.data.rawPixels as Uint16Array;

      let index = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const inFreehand = this.cornerstoneService.pointInFreehand(
            data.roiPoints,
            { x, y }
          );
          if (inFreehand) {
            rawPixels[index] = 255;
          } else {
            rawPixels[index] = 0;
          }
          index++;
        }
      }
      return rawPixels as any;
    };
  };

  _setUpTools = (element: HTMLDivElement): void => {
    cornerstone.enable(element);

    if (this.allLoaded) {
      const synchronizer: Synchronizer = new cornerstoneTools.Synchronizer(
        'cornerstoneimagerendered',
        this.cornerstoneService.panZoomSynchronizer
      );
      const synchronizerStack = new cornerstoneTools.Synchronizer(
        'cornerstoneimagerendered',
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
