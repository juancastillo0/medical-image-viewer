import { Injectable } from '@angular/core';
import * as dicomParser from 'dicom-parser';
import * as _cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as _cornerstone from 'cornerstone-core';
import * as _cornerstoneTools from 'cornerstone-tools';
import * as _cornerstoneMath from 'cornerstone-math';
import * as _cornerstoneNIFTIImageLoader from '@cornerstonejs/nifti-image-loader';
import * as _cornerstoneWebImageLoader from 'cornerstone-web-image-loader';
import Hammer from 'hammerjs';
import {
  CornerstoneModule,
  CornerstoneToolsModule,
  CornerstoneViewport,
  Offset,
  RoiData,
  RoiDataHandlesPoint,
  SynchronizerCallback,
} from './cornerstone-types';
import { getBoundingBox } from './utils';
import { ImageState } from './image-state';

export const cornerstoneTools: CornerstoneToolsModule = _cornerstoneTools;
export const cornerstone: CornerstoneModule = _cornerstone;
export const cornerstoneWADOImageLoader: any = _cornerstoneWADOImageLoader;
export const cornerstoneNIFTIImageLoader: any = _cornerstoneNIFTIImageLoader;
export const cornerstoneMath: any = _cornerstoneMath;
export const cornerstoneWebImageLoader: any = _cornerstoneWebImageLoader;

export enum ToolName {
  Pan = 'Pan',
  FreehandRoi = 'FreehandRoi',
  Probe = 'Probe',
  Zoom = 'Zoom',
  Wwwc = 'Wwwc',
  StackScrollMouseWheel = 'StackScrollMouseWheel',
}

const toolNameToTool: { [key in ToolName]: any } = {
  [ToolName.Pan]: cornerstoneTools.PanTool,
  [ToolName.FreehandRoi]: cornerstoneTools.FreehandRoiTool,
  [ToolName.Probe]: cornerstoneTools.ProbeTool,
  [ToolName.Zoom]: cornerstoneTools.ZoomTool,
  [ToolName.Wwwc]: cornerstoneTools.WwwcTool,
  [ToolName.StackScrollMouseWheel]: cornerstoneTools.StackScrollMouseWheelTool,
};

export const getToolFromName = (toolName: ToolName): any => {
  return toolNameToTool[toolName];
};

type RoiSyncCallback = {
  onUpdateCompleted: (data: RoiData, element: HTMLElement) => boolean;
  didChangeRoi: (data: RoiData, element: HTMLElement) => boolean;
  getImageVisibility: (element: HTMLElement) => boolean;
  shouldSynchronize: () => boolean;
  getTranslation: (
    source: HTMLElement,
    target: HTMLElement
  ) => { dx: number; dy: number };
};

(window as any).getToolFromName = getToolFromName;

@Injectable({
  providedIn: 'root',
})
export class CornerstoneService {
  cornerstoneTools: CornerstoneToolsModule = _cornerstoneTools;
  cornerstone: CornerstoneModule = _cornerstone;
  cornerstoneMath: any = cornerstoneMath;
  pointInFreehand = cornerstoneTools.import('util/freehandUtils')
    .pointInFreehand as (
    handles: { x: number; y: number }[],
    point: { x: number; y: number }
  ) => boolean;

  pointInFreehand2 = (
    polygon: { x: number; y: number }[],
    p: { x: number; y: number },
    bbox?: { left: number; top: number; right: number; bottom: number }
  ): boolean => {
    let isInside = false;
    const box = bbox ?? getBoundingBox(polygon);
    if (
      p.x < box.left ||
      p.x > box.right ||
      p.y < box.top ||
      p.y > box.bottom
    ) {
      return false;
    }
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (
        polygon[i].y > p.y !== polygon[j].y > p.y &&
        p.x <
          ((polygon[j].x - polygon[i].x) * (p.y - polygon[i].y)) /
            (polygon[j].y - polygon[i].y) +
            polygon[i].x
      ) {
        isInside = !isInside;
      }
    }

    return isInside;
  };

  pointInFreehandCached = (
    polygon: { x: number; y: number }[],
    p: { x: number; y: number }
  ): boolean => {
    let isInside = false;
    const coeff: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      coeff.push((polygon[j].x - polygon[i].x) / (polygon[j].y - polygon[i].y));
      if (
        polygon[i].y > p.y !== polygon[j].y > p.y &&
        p.x <
          ((polygon[j].x - polygon[i].x) * (p.y - polygon[i].y)) /
            (polygon[j].y - polygon[i].y) +
            polygon[i].x
      ) {
        isInside = !isInside;
      }
    }

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (
        polygon[i].y > p.y !== polygon[j].y > p.y &&
        p.x < coeff[i] * (p.y - polygon[i].y) + polygon[i].x
      ) {
        isInside = !isInside;
      }
    }

    return isInside;
  };

  lineInFreehand = (
    y: number,
    polygon: { x: number; y: number }[],
    xs: number[]
  ): boolean[] => {
    const coeff = Array<number>(polygon.length);
    const bools = Array<boolean>(polygon.length);
    const results = Array<boolean>(xs.length).map((_) => false);

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      coeff[i] =
        ((polygon[j].x - polygon[i].x) * (y - polygon[i].y)) /
          (polygon[j].y - polygon[i].y) +
        polygon[i].x;
      bools[i] = polygon[i].y > y !== polygon[j].y > y;
    }

    for (let i = 0; i < polygon.length; i++) {
      const b = bools[i];
      const c = coeff[i];
      xs.forEach((x, ind) => {
        if (b && x < c) {
          results[ind] = !results[ind];
        }
      });
    }

    return results;
  };

  constructor() {
    cornerstoneNIFTIImageLoader.external.cornerstone = cornerstone;
    cornerstoneTools.external.cornerstone = cornerstone;
    cornerstoneTools.external.cornerstoneMath = cornerstoneMath;
    cornerstoneTools.external.Hammer = Hammer;
    cornerstoneTools.init();

    cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
    cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
    cornerstoneWebImageLoader.external.cornerstone = cornerstone;

    console.log(cornerstoneTools);
    console.log(cornerstone);
    console.log(cornerstoneMath);
    (window as any).cornerstone = cornerstone;
    (window as any).cornerstoneTools = cornerstoneTools;
    (window as any).cornerstoneMath = cornerstoneMath;
    (window as any).cornerstoneNIFTIImageLoader = cornerstoneNIFTIImageLoader;
    (window as any).cornerstoneWADOImageLoader = cornerstoneWADOImageLoader;
    (window as any).cornerstoneWebImageLoader = cornerstoneWebImageLoader;

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
      webWorkerPath: `${document.location.href}assets/cornerstoneWADOImageLoaderWebWorker.min.js`,
      taskConfiguration: {
        decodeTask: {
          codecsPath: `${document.location.href}assets/cornerstoneWADOImageLoaderCodecs.js`,
        },
      },
    };

    cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
    // cornerstone.registerImageLoader('blob', cornerstoneWebImageLoader);
    cornerstoneWebImageLoader.configure({ beforeSend: () => {} });

    cornerstone.registerUnknownImageLoader(cornerstoneWebImageLoader.loadImage);
  }

  calculateScaleRatio = (
    _sourceViewport: CornerstoneViewport | HTMLElement,
    _targetViewport: CornerstoneViewport | HTMLElement
  ): number => {
    let sourceViewport: CornerstoneViewport;
    if (_sourceViewport instanceof HTMLElement) {
      sourceViewport = cornerstone.getViewport(_sourceViewport);
    } else {
      sourceViewport = _sourceViewport;
    }
    let targetViewport: CornerstoneViewport;
    if (_targetViewport instanceof HTMLElement) {
      targetViewport = cornerstone.getViewport(_targetViewport);
    } else {
      targetViewport = _targetViewport;
    }

    if (false) {
      return (
        sourceViewport.displayedArea.brhc.x /
        targetViewport.displayedArea.brhc.x
      );
    } else {
      return (
        targetViewport.displayedArea.columnPixelSpacing /
        sourceViewport.displayedArea.columnPixelSpacing
      );
    }
  };

  buildTranslatePoints = (
    sourceElement: HTMLElement,
    targetElement: HTMLElement,
    getTranslation: (
      source: HTMLElement,
      target: HTMLElement
    ) => {
      dx: number;
      dy: number;
    }
  ) => {
    const sourceViewport = cornerstone.getViewport(sourceElement);
    const targetViewport = cornerstone.getViewport(targetElement);

    const ratio = this.calculateScaleRatio(sourceViewport, targetViewport);
    const _translation = getTranslation(sourceElement, targetElement);
    return (p: { x: number; y: number }) => ({
      x:
        (p.x - _translation.dx - targetViewport.displayedArea.brhc.x / 2) *
          ratio +
        sourceViewport.displayedArea.brhc.x / 2,
      y:
        (p.y - _translation.dy - targetViewport.displayedArea.brhc.y / 2) *
          ratio +
        sourceViewport.displayedArea.brhc.y / 2,
    });
  };

  panZoomSynchronizer: (
    left: ImageState,
    right: ImageState
  ) => SynchronizerCallback = (left: ImageState, right: ImageState) => (
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

    // const columnSpacing = Math.min(targetViewport.displayedArea.columnPixelSpacing, sourceViewport.displayedArea.columnPixelSpacing)
    // const rowSpacing = Math.min(targetViewport.displayedArea.rowPixelSpacing, sourceViewport.displayedArea.rowPixelSpacing)

    // targetViewport.displayedArea.rowPixelSpacing = rowSpacing
    // targetViewport.displayedArea.rowPixelSpacing = rowSpacing
    // targetViewport.displayedArea.columnPixelSpacing = columnSpacing
    // targetViewport.displayedArea.columnPixelSpacing = columnSpacing

    const ratio = this.calculateScaleRatio(sourceViewport, targetViewport);

    const sourceIsLeft = left.getElement().id === sourceElement.id;
    const newx =
      (sourceViewport.translation.x - (sourceIsLeft ? left.dx : right.dx)) /
        ratio +
      (sourceIsLeft ? right.dx : left.dx);
    const newy =
      (sourceViewport.translation.y - (sourceIsLeft ? left.dy : right.dy)) /
        ratio +
      (sourceIsLeft ? right.dy : left.dy);
    // Do nothing if the scale and translation are the same
    if (
      targetViewport.scale === sourceViewport.scale * ratio &&
      targetViewport.translation.x === newx &&
      targetViewport.translation.y === newy
    ) {
      return;
    }

    // Scale and/or translation are different, sync them
    targetViewport.scale = sourceViewport.scale * ratio;
    targetViewport.translation.x = newx;
    targetViewport.translation.y = newy;
    synchronizer.setViewport(targetElement, targetViewport);
  };

  freehandRoiSynchronizer = (
    callbacks: RoiSyncCallback
  ): SynchronizerCallback => (
    synchronizer,
    targetElement,
    sourceElement,
    eventData
  ) => {
    targetElement.focus();
    this.syncronizeRois(callbacks, targetElement, sourceElement);
  };

  syncronizeRois = (
    callbacks: RoiSyncCallback,
    targetElement: HTMLElement,
    sourceElement: HTMLElement
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

    if (!callbacks.shouldSynchronize()) {
      if (targetRois) {
        for (const dataTarget of targetRois) {
          if (dataTarget.area > 0.1 || dataTarget.canComplete) {
            callbacks.onUpdateCompleted(dataTarget, targetElement);
          }
        }
      }
      return;
    }
    const _translatePoint = this.buildTranslatePoints(
      sourceElement,
      targetElement,
      callbacks.getTranslation
    );

    const makeNewPoint = (p: RoiDataHandlesPoint) => {
      return {
        ...p,
        ..._translatePoint(p),
      };
    };

    const addData = (element: HTMLElement, dataList: RoiData[]) => {
      console.log('addData');
      const image = cornerstone.getImage(element);
      // Get the source and target viewports
      const visible = callbacks.getImageVisibility(element);
      for (const data of dataList) {
        console.log(data, visible);
        const newData = { ...data, visible: data.area < 0.1 || visible };
        newData.handles = { ...newData.handles };
        newData.handles.points = newData.handles.points.map(makeNewPoint);

        cornerstoneTools.addToolState(element, ToolName.FreehandRoi, newData);
        if (newData.canComplete || data.area > 0.1) {
          (_tool as any).updateCachedStats(image, element, newData);
        }
      }
      cornerstone.updateImage(element);
    };

    if (!!sourceRois || !!targetRois) {
      if (!sourceRois) {
        console.log('target more');
        addData(sourceElement, targetRois);
      } else if (!targetRois) {
        console.log('source more');
        addData(targetElement, sourceRois);
      } else {
        console.log('different');
        // if (targetRois.length > sourceRois.length) {
        //   cornerstoneTools.clearToolState(targetElement, ToolName.FreehandRoi);
        //   for (const d of targetRois) {
        //     cornerstoneTools.addToolState(targetElement, ToolName.FreehandRoi, d);
        //   }
        // }

        const visible = callbacks.getImageVisibility(sourceElement);
        for (const dataTarget of targetRois) {
          const didUpdate = callbacks.didChangeRoi(dataTarget, targetElement);

          if (didUpdate) {
            const sourceRoi = sourceRois.find(
              (s) => s.uuid === dataTarget.uuid
            );
            if (sourceRoi !== undefined) {
              cornerstoneTools.removeToolState(
                sourceElement,
                ToolName.FreehandRoi,
                sourceRoi
              );
            }
            const newData = {
              ...dataTarget,
              visible: dataTarget.area < 0.1 || visible,
            };
            newData.handles = { ...newData.handles };
            newData.handles.points = newData.handles.points.map(makeNewPoint);

            cornerstoneTools.addToolState(
              sourceElement,
              ToolName.FreehandRoi,
              newData
            );
            if (newData.canComplete || dataTarget.area > 0.1) {
              callbacks.onUpdateCompleted(newData, sourceElement);
              callbacks.onUpdateCompleted(dataTarget, targetElement);
            } else {
              dataTarget.visible = true;
            }

            // callbacks.onUpdateCompleted(newData, sourceElement);
            break;
          }
        }
        cornerstone.updateImage(sourceElement);
      }
      // TODO: verify for images with different sizes
      (cornerstoneTools.getToolForElement(
        sourceElement,
        ToolName.FreehandRoi
      ) as any)._configuration.mouseLocation.handles.start = {
        ...cornerstoneTools.getToolForElement(
          targetElement,
          ToolName.FreehandRoi
        ),
      };
      cornerstone.updateImage(targetElement);
      cornerstone.updateImage(sourceElement);
    }
  };

  createRoiData = (
    uuid: string,
    points: Offset[],
    visibility: boolean
  ): RoiData => {
    return {
      active: false,
      area: 10,
      canComplete: false,
      handles: {
        invalidHandlePlacement: false,
        points: points.map((p) => ({
          active: false,
          highlight: false,
          lines: [],
          ...p,
        })),
        textBox: {
          active: false,
          allowedOutsideImage: false,
          drawnIndependently: true,
          hasMoved: false,
          movesIndependently: false,
        },
      },
      highlight: false,
      invalidated: false,
      meanStdDev: {
        count: 100,
        mean: 300,
        stdDev: 10,
        variance: 20,
      },
      unit: '',
      uuid,
      visible: visibility,
      polyBoundingBox: getBoundingBox(points),
    };
  };

  stackImageIndexSynchronizer: SynchronizerCallback = (
    synchronizer,
    sourceElem,
    targetElem,
    delta: number
  ): void => {
    // Ignore the case where the source and target are the same enabled element
    if (targetElem === sourceElem) {
      return;
    }
    const sourceStackToolDataSource = cornerstoneTools.getToolState(
      sourceElem,
      'stack'
    );
    const sourceStackData = sourceStackToolDataSource.data[0];
    const targetStackToolDataSource = cornerstoneTools.getToolState(
      targetElem,
      'stack'
    );
    const targetStackData = targetStackToolDataSource.data[0];

    let newImageIdIndex = sourceStackData.currentImageIdIndex - delta;
    console.log(delta, newImageIdIndex);
    // Clamp the index
    newImageIdIndex = Math.min(
      Math.max(newImageIdIndex, 0),
      targetStackData.imageIds.length - 1
    );

    // Do nothing if the index has not changed
    if (newImageIdIndex === targetStackData.currentImageIdIndex) {
      return;
    }
    const loadHandlerManager = cornerstoneTools.loadHandlerManager;
    const startLoadingHandler = loadHandlerManager.getStartLoadHandler(
      targetElem
    );
    const endLoadingHandler = loadHandlerManager.getEndLoadHandler(targetElem);
    const errorLoadingHandler = loadHandlerManager.getErrorLoadingHandler(
      targetElem
    );

    if (startLoadingHandler) {
      startLoadingHandler(targetElem);
    }

    let loader;

    if (targetStackData.preventCache === true) {
      loader = cornerstone.loadImage(targetStackData.imageIds[newImageIdIndex]);
    } else {
      loader = cornerstone.loadAndCacheImage(
        targetStackData.imageIds[newImageIdIndex]
      );
    }

    loader.then(
      (image) => {
        const viewport = cornerstone.getViewport(targetElem);

        targetStackData.currentImageIdIndex = newImageIdIndex;
        synchronizer.displayImage(targetElem, image, viewport);
        if (endLoadingHandler) {
          endLoadingHandler(targetElem, image);
        }
      },
      (error) => {
        const imageId = targetStackData.imageIds[newImageIdIndex];

        if (errorLoadingHandler) {
          errorLoadingHandler(targetElem, imageId, error);
        }
      }
    );
  };
}
