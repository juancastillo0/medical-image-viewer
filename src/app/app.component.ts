import { Component, ElementRef, ViewChild } from '@angular/core';
import * as dicomParser from 'dicom-parser';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as _cornerstone from 'cornerstone-core';
import * as _cornerstoneTools from 'cornerstone-tools';
import * as cornerstoneMath from 'cornerstone-math';
import * as cornerstoneNIFTIImageLoader from '@cornerstonejs/nifti-image-loader';
import Hammer from 'hammerjs';
import {
  CornerstoneModule,
  CornerstoneToolsModule,
  RoiData,
  Synchronizer,
  SynchronizerCallback,
} from './cornerstone-types';
import { v4 as uuidv4 } from 'uuid';
import embed, { VisualizationSpec } from 'vega-embed';

const cornerstoneTools: CornerstoneToolsModule = _cornerstoneTools;
const cornerstone: CornerstoneModule = _cornerstone;

cornerstoneNIFTIImageLoader.external.cornerstone = cornerstone;
cornerstoneTools.external.cornerstone = cornerstone;
cornerstoneTools.external.cornerstoneMath = cornerstoneMath;
cornerstoneTools.external.Hammer = Hammer;
cornerstoneTools.init();

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

console.log(cornerstoneTools);
console.log(cornerstone);
(window as any).cornerstone = cornerstone;
(window as any).cornerstoneTools = cornerstoneTools;
(window as any).cornerstoneMath = cornerstoneMath;
(window as any).cornerstoneNIFTIImageLoader = cornerstoneNIFTIImageLoader;
(window as any).cornerstoneWADOImageLoader = cornerstoneWADOImageLoader;

function getBlobUrl(url: string): string {
  const baseUrl = window.URL || window.webkitURL;
  const blob = new Blob([`importScripts('${url}')`], {
    type: 'application/javascript',
  });

  return baseUrl.createObjectURL(blob);
}

const webWorkerUrl = getBlobUrl(
  'https://unpkg.com/cornerstone-wado-image-loader@2.2.4/dist/cornerstoneWADOImageLoaderWebWorker.min.js'
);
const codecsUrl = getBlobUrl(
  'https://unpkg.com/cornerstone-wado-image-loader@2.2.4/dist/cornerstoneWADOImageLoaderCodecs.js'
);

const config = {
  webWorkerPath: webWorkerUrl,
  taskConfiguration: {
    decodeTask: {
      codecsPath: codecsUrl,
    },
  },
};

cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

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
type ImageMetadata = ReturnType<AppComponent['getSummary']>;

const _getToolName = (_tool: any): string => {
  return (_tool.name as string).slice(0, _tool.name.length - 4);
};

enum ToolName {
  Pan = 'Pan',
  FreehandRoi = 'FreehandRoi',
  Probe = 'Probe',
}

enum InfoView {
  Comparison = 'Comparison',
  Metadata = 'Metadata',
}
const panZoomSynchronizer: SynchronizerCallback = (
  synchronizer,
  sourceElement,
  targetElement
) => {
  // Ignore the case where the source and target are the same enabled element
  if (targetElement === sourceElement) {
    return;
  }

  // Get the source and target viewports
  const sourceViewport = cornerstone.getViewport(sourceElement);
  const targetViewport = cornerstone.getViewport(targetElement);

  const ratio =
    targetViewport.displayedArea.columnPixelSpacing /
    sourceViewport.displayedArea.columnPixelSpacing;

  // Do nothing if the scale and translation are the same
  if (
    targetViewport.scale === sourceViewport.scale * ratio &&
    targetViewport.translation.x === sourceViewport.translation.x / ratio &&
    targetViewport.translation.y === sourceViewport.translation.y / ratio
  ) {
    return;
  }

  // Scale and/or translation are different, sync them
  targetViewport.scale = sourceViewport.scale * ratio;
  targetViewport.translation.x = sourceViewport.translation.x / ratio;
  targetViewport.translation.y = sourceViewport.translation.y / ratio;
  synchronizer.setViewport(targetElement, targetViewport);
};

const freehandRoiSynchronizer = (callbacks: {
  onUpdateCompleted: (
    target: RoiData & { element: HTMLElement },
    source: RoiData & { element: HTMLElement }
  ) => void;
}): SynchronizerCallback => (
  synchronizer,
  targetElement,
  sourceElement,
  eventData
) => {
  if (targetElement === sourceElement) {
    return;
  }

  const _tool = cornerstoneTools.getToolForElement(
    sourceElement,
    ToolName.FreehandRoi
  );
  if (_tool.mode === 'disabled' || _tool.mode === 'enabled') {
    // The state cannot be modified
    return;
  }

  const sourceRois: RoiData[] = cornerstoneTools.getToolState(
    sourceElement,
    ToolName.FreehandRoi
  )?.data;
  const targetRois: RoiData[] = cornerstoneTools.getToolState(
    targetElement,
    ToolName.FreehandRoi
  )?.data;

  const updateImageAndDataFactory = (
    element: HTMLElement,
    dataList: RoiData[]
  ) => {
    const image = cornerstone.getImage(element);
    for (const data of dataList) {
      if (data.area > 0.1 || data.canComplete) {
        (_tool as any).updateCachedStats(image, element, data);
      } else {
        console.log(data);
      }
    }
    cornerstone.updateImage(element);
  };

  const addData = (element: HTMLElement, dataList: RoiData[]) => {
    const image = cornerstone.getImage(element);
    for (const data of dataList) {
      const newData = { ...data };
      newData.uuid = uuidv4();
      cornerstoneTools.addToolState(element, ToolName.FreehandRoi, newData);
      if (newData.canComplete || data.area > 0.1) {
        (_tool as any).updateCachedStats(image, element, newData);
      }
    }
    cornerstone.updateImage(element);
  };

  console.log(sourceRois);
  console.log(targetRois);
  console.log(_tool);

  if (!!sourceRois || !!targetRois) {
    if (!sourceRois) {
      addData(sourceElement, targetRois);
    } else if (!targetRois) {
      addData(targetElement, sourceRois);
    } else if (sourceRois.length !== targetRois.length) {
      // if (targetRois.length > sourceRois.length) {
      //   cornerstoneTools.clearToolState(targetElement, ToolName.FreehandRoi);
      //   for (const d of targetRois) {
      //     cornerstoneTools.addToolState(targetElement, ToolName.FreehandRoi, d);
      //   }
      // }
      const toRemove = sourceElement;
      const data = targetRois;
      cornerstoneTools.clearToolState(toRemove, ToolName.FreehandRoi);
      addData(toRemove, data);
      // if (targetRois.length > sourceRois.length) {
      //   cornerstoneTools.clearToolState(targetElement, ToolName.FreehandRoi);
      //   for (const d of targetRois) {
      //     cornerstoneTools.addToolState(targetElement, ToolName.FreehandRoi, d);
      //   }
      // }
      // const toRemove =
      //   sourceRois.length > targetRois.length ? targetElement : sourceElement;
      // const data =
      //   sourceRois.length > targetRois.length ? sourceRois : targetRois;
      // cornerstoneTools.clearToolState(toRemove, ToolName.FreehandRoi);
      // addData(toRemove, data);
    } else {
      const targetImage = cornerstone.getImage(targetElement);
      const sourceImage = cornerstone.getImage(sourceElement);
      for (let i = 0; i < targetRois.length; i++) {
        const data = targetRois[i];
        const dataSource = sourceRois[i];
        if (data.area > 0.1 || data.canComplete) {
          (_tool as any).updateCachedStats(targetImage, targetElement, data);
          (_tool as any).updateCachedStats(
            sourceImage,
            sourceElement,
            dataSource
          );

          callbacks.onUpdateCompleted(
            { ...data, element: targetElement },
            { ...dataSource, element: sourceElement }
          );
        } else {
          console.log(data);
        }
      }
      cornerstone.updateImage(targetElement);
      cornerstone.updateImage(sourceElement);
    }
  }
};

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  ToolName = ToolName;
  InfoView = InfoView;

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
    const right = target.handles.points.reduce((p, c) => Math.max(p, c.x), 0);
    const left = target.handles.points.reduce(
      (p, c) => Math.min(p, c.x),
      Number.MAX_VALUE
    );
    const width = Math.floor(right - left);
    const bottom = target.handles.points.reduce((p, c) => Math.max(p, c.y), 0);
    const top = target.handles.points.reduce(
      (p, c) => Math.min(p, c.y),
      Number.MAX_VALUE
    );
    const height = Math.floor(bottom - top);

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

    const sourcePixels = cornerstone.getPixels(
      source.element,
      left,
      top,
      width,
      height
    );

    const targetPos =
      target.element.id === this.imageDataLeft.getElement().id
        ? 'Left'
        : 'Right';
    const sourcePos =
      source.element.id === this.imageDataLeft.getElement().id
        ? 'Left'
        : 'Right';

    const data = targetPixels.map((p, index) => ({
      t: p,
      s: sourcePixels[index],
    }));

    const data2 = [
      ...targetPixels.map((p, index) => ({
        intensity: p,
        type: targetPos,
      })),
      ...sourcePixels.map((p, index) => ({
        intensity: p,
        type: sourcePos,
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

    // layer: [
    //   {
    //     mark: 'bar',
    //     encoding: {
    //       x: {
    //         bin: true,
    //         field: 't',
    //       },
    //       y: { aggregate: 'count' },
    //       opacity: { value: 0.7 },
    //       color: { value: '#ca8861' },
    //     },
    //   },
    //   {
    //     mark: 'bar',
    //     encoding: {
    //       x: {
    //         bin: true,
    //         field: 's',
    //       },
    //       y: { aggregate: 'count' },
    //       opacity: { value: 0.7 },
    //       color: { value: '#675193' },
    //     },
    //   },
    // ]

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
      const imageIds = files.map((file) => {
        console.log(file.type);
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
        if (this.imageDataLeft.loaded) {
          cornerstoneTools.clearToolState(data.getElement(), this.enabledTool);
          cornerstone.updateImage(data.getElement());
        }
      }
    }
  };

  loadAndViewNifti = (file: File) => {
    const url = URL.createObjectURL(file);
    const imageId = `nifti:${url}`;
    const imageIdObject = cornerstoneNIFTIImageLoader.nifti.ImageId.fromURL(
      imageId
    );
  };

  toggleTool = (toolName: ToolName): void => {
    if (this.imageDataLeft.loaded || this.imageDataRight.loaded) {
      if (this.enabledTool !== toolName) {
        this.enabledTool = toolName;
        cornerstoneTools.setToolActive(toolName, { mouseButtonMask: 1 });
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
      }
    }
  };

  loadAndViewImages = async (
    imageIds: string[],
    data: ImageData
  ): Promise<void> => {
    data.loading = true;
    const _images = await Promise.all(
      imageIds.map((id) =>
        cornerstone
          .loadImage(id)
          .then((_image) => {
            console.log(_image);
            return {
              image: _image,
              metadata: this.getSummary(_image.data),
            };
          })
          .catch<undefined>((e: any) => {
            console.log(e);
            return undefined;
          })
      )
    );
    const images = _images
      .filter((im) => im !== undefined)
      .sort((a, b) => a.metadata.instanceId - b.metadata.instanceId);
    const firstImage = images[0].image;
    console.log('image', firstImage);

    let stack: { currentImageIdIndex: number; imageIds: string[] };
    if (images[0].metadata !== undefined) {
      const info = images[0].metadata.info;
      data.parsingResult = {
        info,
        warnings: firstImage.data.warnings,
        filteredInfo: info,
      };
      stack = {
        currentImageIdIndex: 0,
        imageIds: images.map((im) => im.image.imageId),
      };
    } else {
      const imageIdObject = cornerstoneNIFTIImageLoader.nifti.ImageId.fromURL(
        images[0].image.imageId
      );
      const info = this.getNiftiSummary(images[0].image.imageId);
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
    // document.getElementById("toggleModalityLUT").checked =
    //   viewport.modalityLUT !== undefined;
    // document.getElementById("toggleVOILUT").checked =
    //   viewport.voiLUT !== undefined;
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
        panZoomSynchronizer // cornerstoneTools.panZoomSynchronizer
      );
      const synchronizerStack = new cornerstoneTools.Synchronizer(
        'cornerstoneimagerendered',
        cornerstoneTools.stackImageIndexSynchronizer
      );

      const synchronizerFreehandRoi = new cornerstoneTools.Synchronizer(
        'click',
        freehandRoiSynchronizer({ onUpdateCompleted: this.drawCompCanvas })
      );

      for (const { getElement } of [this.imageDataLeft, this.imageDataRight]) {
        const el = getElement();
        synchronizer.add(el);
        synchronizerStack.add(el);
        synchronizerFreehandRoi.add(el);
      }

      (window as any).synchronizer = synchronizer;
      tool = cornerstoneTools.PanTool;
      cornerstoneTools.addTool(tool);
      cornerstoneTools.setToolActive(_getToolName(tool), {
        mouseButtonMask: 1,
        synchronizationContext: synchronizer,
      });

      tool = cornerstoneTools.ZoomTool;
      cornerstoneTools.addTool(tool);
      cornerstoneTools.setToolActive(_getToolName(tool), {
        mouseButtonMask: 2,
        synchronizationContext: synchronizer,
      });

      tool = cornerstoneTools.StackScrollMouseWheelTool;
      cornerstoneTools.addTool(tool);
      cornerstoneTools.setToolActive(_getToolName(tool), {
        synchronizationContext: synchronizerStack,
      });

      tool = cornerstoneTools.FreehandRoiTool;
      cornerstoneTools.addTool(tool, {
        synchronizationContext: synchronizerFreehandRoi,
      });
    }

    tool = cornerstoneTools.PanTool;
    cornerstoneTools.addTool(tool);
    cornerstoneTools.setToolActive(_getToolName(tool), {
      mouseButtonMask: 1,
    });

    tool = cornerstoneTools.ZoomTool;
    cornerstoneTools.addTool(tool);
    cornerstoneTools.setToolActive(_getToolName(tool), {
      mouseButtonMask: 2,
    });

    tool = cornerstoneTools.WwwcTool;
    cornerstoneTools.addToolForElement(element, tool);
    cornerstoneTools.setToolActiveForElement(element, _getToolName(tool), {
      mouseButtonMask: 4,
    });

    tool = cornerstoneTools.StackScrollMouseWheelTool;
    cornerstoneTools.addTool(tool);
    cornerstoneTools.setToolActive(_getToolName(tool), {});

    tool = cornerstoneTools.ProbeTool;
    cornerstoneTools.addTool(tool);

    tool = cornerstoneTools.FreehandRoiTool;
    cornerstoneTools.addTool(tool);

    // cornerstoneTools.imageStats.enable(element);
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

  getSummary = (
    dataSet: dicomParser.DataSet
  ): { instanceId: number; info: { [key: string]: string } } | undefined => {
    if (dataSet === undefined) {
      return undefined;
    }
    const info: { [key: string]: string } = {};
    Object.entries(dicomIdMap).forEach(([key, value]) => {
      const element = dataSet.elements[value];
      let text = '';
      if (element !== undefined) {
        const str = dataSet.string(value);
        if (str !== undefined) {
          text = str;
        }
      }
      info[key] = text;
    });
    info['Image Orientation Patient'] = info[
      'Image Orientation Patient'
    ].replace(/\\/g, '\\ ');

    Object.entries(dicomIdMapUint).forEach(([key, value]) => {
      const element = dataSet.elements[value];
      let text = '';
      if (element !== undefined) {
        if (element.length === 2) {
          text += dataSet.uint16(value);
        } else if (element.length === 4) {
          text += dataSet.uint32(value);
        }
      }

      info[key] = text;
    });
    // tslint:disable-next-line: radix
    return { info, instanceId: Number.parseInt(info['Instance #']) };
  };

  getNiftiSummary = (imageId: string): { [key: string]: string } => {
    const summary: { [key: string]: string } = {};
    const getMetaData = (type: string): string =>
      cornerstone.metaData.get(type, imageId);

    const data = {
      imagePixelModule: [
        'columns',
        'rows',
        'samplesPerPixel',
        'photometricInterpretation',
        'planarConfiguration',
        'pixelAspectRatio',
        'bitsAllocated',
        'bitsStored',
        'highBit',
        'pixelRepresentation',
        'smallestPixelValue',
        'largestPixelValue',
      ],
    };

    Object.entries(data).forEach(([key, valueList]) => {
      valueList.forEach((value) => {
        summary[value] = '' + getMetaData(key)[value];
      });
    });

    const otherData = [
      ['numberOfFrames', 'multiFrameModule'],
      ['pixelSpacing', 'imagePlaneModule'],
      ['windowCenter', 'voiLutModule'],
      ['windowWidth', 'voiLutModule'],
      ['rescaleIntercept', 'modalityLutModule'],
      ['rescaleSlope', 'modalityLutModule'],
    ];

    otherData.forEach(([value, key]) => {
      summary[value] = '' + getMetaData(key)[value];
    });

    return summary;
  };
}

const dicomIdMap = {
  // UIDS
  'Study UID': 'x0020000d',
  'Series UID': 'x0020000e',
  'Instance UID': 'x00080018',
  'SOP Class UID': 'x00080016',
  'Transfer Syntax UID': 'x00020010',
  'Frame of Reference UID': 'x00200052',
  // Equipment Information
  Manufacturer: 'x00080070',
  Model: 'x00081090',
  'Station Name': 'x00081010',
  'AE Title': 'x00020016',
  'Institution Name': 'x00080080',
  'Software Version': 'x00181020',
  'Implementation Version Name': 'x00020013',
  // Image Information
  'Photometric Interpretation': 'x00280004',
  'Image Type': 'x00080008',
  'Window Center': 'x00281050',
  'Window Width': 'x00281051',
  'Rescale Slope': 'x00281053',
  'Rescale Intercept': 'x00281052',
  'Image Position Patient': 'x00200032',
  'Image Orientation Patient': 'x00200037',
  'Pixel Spacing': 'x00280030',
  // Instance Information
  'Instance #': 'x00200013',
  'Acquisition #': 'x00200012',
  'Acquisition Date': 'x00080022',
  'Acquisition Time': 'x00080032',
  'Content Date': 'x00080023',
  'Content Time': 'x00080033',
  // Patient Information
  'Patient Name': 'x00100010',
  'Patient ID': 'x00100020',
  'Patient Birth Date': 'x00100030',
  'Patient Sex': 'x00100040',
  // Study Information
  'Study Description': 'x00081030',
  'Protocol Name': 'x00181030',
  'Accession #': 'x00080050',
  'Study Id': 'x00200010',
  'Study Date': 'x00080020',
  'Study Time': 'x00080030',
  // Series Information
  'Series Description': 'x0008103e',
  'Series #': 'x00200011',
  Modality: 'x00080060',
  'Body Part': 'x00180015',
  'Series Date': 'x00080021',
  'Series Time': 'x00080031',
};

const dicomIdMapUint = {
  // Image Information
  Rows: 'x00280010',
  Columns: 'x00280011',
  'Bits Allocated': 'x00280100',
  'Bits Stored': 'x00280101',
  HighBit: 'x00280102',
  'Pixel Representation (0=us)': 'x00280103',
  'Samples Per Pixel': 'x00280002',
};
