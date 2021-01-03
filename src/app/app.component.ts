import { Component, ElementRef, ViewChild } from '@angular/core';
import { ImageState, ParsingResult } from './image-state';
import {
  CornerstoneColormap,
  CornerstoneImage,
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
import { roisAreEqual } from './utils';
import { ImageStats } from './image-stats';
import { ImageRegistration } from './image-registration';
import { ImageOverlay } from './image-overlay';

export enum HistogramRegion {
  volume = 'volume',
  lastRoi = 'lastRoi',
  stackPosition = 'stackPosition',
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
  HistogramRegion = HistogramRegion;
  colormaps = cornerstone.colors.getColormapsList();

  constructor(
    private cornerstoneService: CornerstoneService,
    private metadataService: ImageMetadataService
  ) {
    (window as any).app = this;
    (window as any).dataL = this.imageDataLeft;
    (window as any).dataR = this.imageDataRight;

    this.stats = new ImageStats({
      left: this.imageDataLeft,
      right: this.imageDataRight,
    });
    this.registration = new ImageRegistration({
      left: this.imageDataLeft,
      right: this.imageDataRight,
    });
    this.overlay = new ImageOverlay(this.cornerstoneService, {
      getTranslation: this.getTranslation,
      updateVolumeStats: () => {
        this.stats.updateVolumeStats(this.lastRoiUuid);
      },
    });
  }

  readonly defaultTool = ToolName.Pan;
  enabledTool = ToolName.Pan;
  selectedColormap = CornerstoneColormap.hotIron;
  lastRoiUuid?: string;
  deltaStackIndex = 0;

  importedImageIds: Map<string, Array<string>> = new Map();
  stats: ImageStats;
  registration: ImageRegistration;
  overlay: ImageOverlay;

  imageDataLeft = new ImageState(() => this._dicomImageLeftElem.nativeElement, {
    isLeft: true,
  });
  imageDataRight = new ImageState(
    () => this._dicomImageRightElem.nativeElement,
    { isLeft: false }
  );

  synchronizeRoi = true;
  synchronizeStack = true;
  isLoadingRegistration = false;

  get allLoaded(): boolean {
    return this.imageDataLeft.loaded && this.imageDataRight.loaded;
  }

  selectedHistogram: HistogramType = HistogramType.dist;
  get volumeStats() {
    return this.stats.volumeStats;
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
  @ViewChild('dicomImageRight')
  _dicomImageRightElem: ElementRef<HTMLDivElement>;

  changeImage = (selectElem: HTMLSelectElement, imageData: ImageState) => {
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

  updateLayerOpacity = (opacity: number, imageData: ImageState) => {
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

  updateLayerVisibility = (imageData: ImageState) => {
    imageData.visible = !imageData.visible;
    this.synchronizeRoiPoints(imageData);
    cornerstone.updateImage(imageData.getElement());
  };

  updateRoiSynchronization = () => {
    this.synchronizeRoi = !this.synchronizeRoi;
  };

  updateStackSynchronization = () => {
    this.synchronizeStack = !this.synchronizeStack;
  };

  _didChangeRoi = (data: RoiData, element: HTMLElement): boolean => {
    let imageData: ImageState;
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
    let imageData: ImageState;
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
    this.stats.setSelectedSide(imageData);
    const stackIndex = imageData.currentStackIndex();
    imageData.setPoints(stackIndex, data);

    cornerstone.updateImage(imageData.getElement(), true);
    return true;
  };

  uploadFile = (fileList: FileList, data: ImageState): void => {
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

  otherData = (data: ImageState) =>
    data === this.imageDataLeft ? this.imageDataRight : this.imageDataLeft;

  loadAndViewImages = async (
    fileName: string,
    imageIds: Array<string>,
    data: ImageState,
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
    data.stackPosition = stack.currentImageIdIndex;
    data.stackSize = stack.imageIds.length;
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

    data.dynamicImage = this.overlay.createOverlayImage(
      firstImage,
      data,
      this.otherData(data)
    );
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

    element.addEventListener(cornerstoneTools.EVENTS.STACK_SCROLL, (e) =>
      this.onStackScroll(e, data)
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

  onStackScroll = async (e: any, data: ImageState) => {
    const eDetail = (e as any).detail as {
      newImageIdIndex: number;
      direction: 1 | -1;
    };
    data.stackPosition = eDetail.newImageIdIndex;
    const otherData = this.otherData(data);
    const otherIndex = otherData.loaded
      ? Math.min(
          Math.max(
            otherData.currentStackIndex() +
              (otherData.isLeft ? 1 : -1) * this.deltaStackIndex,
            0
          ),
          otherData.stackSize - 1
        )
      : 0;

    if (this.synchronizeStack) {
      if ([this.imageDataLeft, this.imageDataRight].every((d) => d.loaded)) {
        let retries = 0;
        while (retries < 5 && eDetail.newImageIdIndex !== otherIndex) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          retries++;
        }

        otherData.stackPosition = data.isLeft
          ? this.imageDataRight.currentStackIndex()
          : this.imageDataLeft.currentStackIndex();
      }

      for (const d of [this.imageDataLeft, this.imageDataRight]) {
        if (
          !d.loaded ||
          (d === data && eDetail.newImageIdIndex !== d.currentStackIndex()) ||
          (d === otherData && otherIndex === d.currentStackIndex())
        ) {
          return;
        }
        this.synchronizeRoiPoints(d);
        cornerstone.updateImage(d.getElement(), true);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 20));
      this.synchronizeRoiPoints(data);
      cornerstone.updateImage(data.getElement(), true);
    }
  };

  synchronizeRoiPoints = (data: ImageState): boolean => {
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

  _setUpTools = (element: HTMLDivElement): void => {
    cornerstone.enable(element);

    if (this.allLoaded) {
      const synchronizer: Synchronizer = new cornerstoneTools.Synchronizer(
        cornerstone.EVENTS.IMAGE_RENDERED,
        this.cornerstoneService.panZoomSynchronizer(
          this.imageDataLeft,
          this.imageDataRight
        )
      );
      const synchronizerStack = new cornerstoneTools.Synchronizer(
        cornerstone.EVENTS.IMAGE_RENDERED,
        (_synchronizer, target, source, eventData) => {
          if (this.synchronizeStack) {
            return this.cornerstoneService.stackImageIndexSynchronizer(
              _synchronizer,
              target,
              source,
              this.imageDataLeft.getElement().id === target.id
                ? this.deltaStackIndex
                : -this.deltaStackIndex
            );
          }
        }
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
          shouldSynchronize: () => this.synchronizeRoi && this.synchronizeStack,
          getTranslation: this.getTranslation,
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

  resetStackPosition = () => {
    const indexLeft = this.imageDataLeft.currentStackIndex();
    // TODO:
    // const pL = this.imageDataLeft.roiPointsByStack.flatMap(s => Object.values(s));
    // const pR = this.imageDataRight.roiPointsByStack.flatMap(s => Object.values(s));
    // for (const v of pL) {
    //   if (pR[v.uuid] !== undefined){

    //   }
    // }
    this.imageDataLeft.removeData(HistogramRegion.volume, '');
    this.imageDataRight.removeData(HistogramRegion.volume, '');

    const indexRight = this.imageDataRight.currentStackIndex();
    this.deltaStackIndex = indexLeft - indexRight;
    this.synchronizeStack = true;
  };

  selectMetadata = (isLeft: boolean) => {
    this.isLeftSelected = isLeft;
    this._updateMetadata();
  };

  selectHistogram = (histType: HistogramType) => {
    this.selectedHistogram = histType;
  };
  selectHistogramRegion = (histRegion: HistogramRegion) => {
    this.stats.updateHistogramRegion(histRegion, this.lastRoiUuid);
  };

  onSearchInput = (inputStr: string) => {
    this.metadataFilter = inputStr.toLowerCase();
    this._updateMetadata();
  };

  getTranslation = (source: HTMLElement, target: HTMLElement) => {
    const result = {
      dx: this.imageDataRight.dx,
      dy: this.imageDataRight.dy,
    };
    const ratio = this.cornerstoneService.calculateScaleRatio(
      this.imageDataRight.getElement(),
      this.imageDataLeft.getElement()
    );

    if (this.imageDataLeft.getElement().id === source.id) {
      console.log('top');
      result.dx = -result.dx;
      result.dy = -result.dy;
    } else {
      console.log('bottom');
      result.dx = result.dx / ratio;
      result.dy = result.dy / ratio;
    }
    return result;
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
