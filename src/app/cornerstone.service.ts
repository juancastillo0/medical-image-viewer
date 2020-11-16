import { Injectable } from '@angular/core';
import * as dicomParser from 'dicom-parser';
import * as _cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as _cornerstone from 'cornerstone-core';
import * as _cornerstoneTools from 'cornerstone-tools';
import * as _cornerstoneMath from 'cornerstone-math';
import * as _cornerstoneNIFTIImageLoader from '@cornerstonejs/nifti-image-loader';
import Hammer from 'hammerjs';
import {
  CornerstoneModule,
  CornerstoneToolsModule,
  Offset,
  RoiData,
  SynchronizerCallback,
} from './cornerstone-types';
import { getBoundingBox } from './utils';

export const cornerstoneTools: CornerstoneToolsModule = _cornerstoneTools;
export const cornerstone: CornerstoneModule = _cornerstone;
export const cornerstoneWADOImageLoader: any = _cornerstoneWADOImageLoader;
export const cornerstoneNIFTIImageLoader: any = _cornerstoneNIFTIImageLoader;
export const cornerstoneMath: any = _cornerstoneMath;

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

  constructor() {
    cornerstoneNIFTIImageLoader.external.cornerstone = cornerstone;
    cornerstoneTools.external.cornerstone = cornerstone;
    cornerstoneTools.external.cornerstoneMath = cornerstoneMath;
    cornerstoneTools.external.Hammer = Hammer;
    cornerstoneTools.init();

    cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
    cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

    console.log(cornerstoneTools);
    console.log(cornerstone);
    console.log(cornerstoneMath);
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
      webWorkerPath: `${document.location.href}assets/cornerstoneWADOImageLoaderWebWorker.min.js`,
      taskConfiguration: {
        decodeTask: {
          codecsPath: `${document.location.href}assets/cornerstoneWADOImageLoaderCodecs.js`,
        },
      },
    };

    cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
  }

  panZoomSynchronizer: SynchronizerCallback = (
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
  freehandRoiSynchronizer = (callbacks: {
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
    targetElement.focus();
    this.syncronize(callbacks, targetElement, sourceElement);
  };

  syncronize = (
    callbacks: {
      onUpdateCompleted: (
        target: RoiData & { element: HTMLElement },
        source: RoiData & { element: HTMLElement }
      ) => void;
    },
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

    const updateImageAndDataFactory = (
      element: HTMLElement,
      dataList: RoiData[]
    ) => {
      const image = cornerstone.getImage(element);
      for (const data of dataList) {
        if (data.area > 0.1 || data.canComplete) {
          (_tool as any).updateCachedStats(image, element, data);
        } else {
          // console.log(data);
        }
      }
      cornerstone.updateImage(element);
    };
    const sourceViewport = cornerstone.getViewport(sourceElement);
    const targetViewport = cornerstone.getViewport(targetElement);

    const ratio =
      targetViewport.displayedArea.columnPixelSpacing /
      sourceViewport.displayedArea.columnPixelSpacing;

    const addData = (element: HTMLElement, dataList: RoiData[]) => {
      const image = cornerstone.getImage(element);
      // Get the source and target viewports

      for (const data of dataList) {
        const newData = { ...data };
        newData.handles = { ...newData.handles };
        newData.handles.points = newData.handles.points.map((p) => ({
          ...p,
          x: p.x * ratio,
          y: p.y * ratio,
        }));

        cornerstoneTools.addToolState(element, ToolName.FreehandRoi, newData);
        if (newData.canComplete || data.area > 0.1) {
          (_tool as any).updateCachedStats(image, element, newData);
        }
      }
      cornerstone.updateImage(element);
    };

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
          const dataTarget = targetRois[i];
          const dataSource = sourceRois[i];
          dataSource.handles.points = dataTarget.handles.points.map((p) => ({
            ...p,
            x: p.x * ratio,
            y: p.y * ratio,
          }));
          if (dataTarget.area > 0.1 || dataTarget.canComplete) {
            (_tool as any).updateCachedStats(
              targetImage,
              targetElement,
              dataTarget
            );
            (_tool as any).updateCachedStats(
              sourceImage,
              sourceElement,
              dataSource
            );

            callbacks.onUpdateCompleted(
              { ...dataTarget, element: targetElement },
              { ...dataSource, element: sourceElement }
            );
          } else {
            console.log(dataTarget);
          }
        }
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

  createRoiData = (uuid: string, points: Offset[]): RoiData => {
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
      visible: true,
      polyBoundingBox: getBoundingBox(points),
    };
  };
}
