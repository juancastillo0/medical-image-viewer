import { Component, ElementRef, ViewChild } from '@angular/core';
import * as dicomParser from 'dicom-parser';

import embed, { VisualizationSpec } from 'vega-embed';
import { CornerstoneImage, RoiData, Synchronizer } from './cornerstone-types';
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
import { getBoundingBox } from './utils';

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
};

enum InfoView {
  Comparison = 'Comparison',
  Metadata = 'Metadata',
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  ToolName = ToolName;
  InfoView = InfoView;

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
  };

  imageDataRight: ImageData = {
    loading: false,
    loaded: false,
    parsingResult: undefined,
    getElement: () => this._dicomImageRightElem.nativeElement,
  };

  get allLoaded(): boolean {
    return this.imageDataLeft.loaded && this.imageDataRight.loaded;
  }

  // METADATA

  currentInfoView: InfoView = InfoView.Metadata;
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
      this.drawHistogram(targetPixels, sourcePixels);
    } else {
      this.drawHistogram(sourcePixels, targetPixels);
    }
  };

  drawHistogram = (leftPixels: number[], rightPixels: number[]): void => {
    const difference = leftPixels.map((p, index) => p - rightPixels[index]);

    const data2 = [
      ...leftPixels.map((p) => ({
        intensity: p,
        type: 'Left',
      })),
      ...rightPixels.map((p) => ({
        intensity: p,
        type: 'Right',
      })),
    ];

    const spec: VisualizationSpec = {
      width: 600,
      data: {
        values: data2,
      },
      mark: 'bar',
      encoding: {
        x: { field: 'intensity', bin: true },
        y: {
          aggregate: 'count',
          stack: null,
        },
        color: {
          field: 'type',
          scale: { range: ['#675193', '#ca8861'] },
        },
        opacity: { value: 0.7 },
      },
    };

    embed('#compChart', spec);
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
    const viewport = cornerstone.getDefaultViewportForImage(
      element,
      firstImage
    );
    cornerstone.displayImage(element, firstImage, viewport);

    cornerstoneTools.addStackStateManager(element, ['stack']);
    cornerstoneTools.addToolState(element, 'stack', stack);

    data.loading = false;
  };

  _setUpTools = (element: HTMLDivElement): void => {
    cornerstone.enable(element);

    let tool: any;
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
        'click',
        this.cornerstoneService.freehandRoiSynchronizer({
          onUpdateCompleted: this.drawCompCanvas,
        })
      );

      for (const { getElement } of [this.imageDataLeft, this.imageDataRight]) {
        const el = getElement();
        synchronizer.add(el);
        synchronizerStack.add(el);
        synchronizerFreehandRoi.add(el);
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
