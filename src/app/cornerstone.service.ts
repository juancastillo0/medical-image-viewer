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

type RoiSyncCallback = {
  onUpdateCompleted: (data: RoiData, element: HTMLElement) => boolean;
  didChangeRoi: (data: RoiData, element: HTMLElement) => boolean;
  getImageVisibility: (element: HTMLElement) => boolean;
  shouldSynchronize: () => boolean;
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

  freehandRoiSynchronizer = (
    callbacks: RoiSyncCallback
  ): SynchronizerCallback => (
    synchronizer,
    targetElement,
    sourceElement,
    eventData
  ) => {
    targetElement.focus();
    this.syncronize(callbacks, targetElement, sourceElement);
  };

  syncronize = (
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
      for (const dataTarget of targetRois) {
        if (dataTarget.area > 0.1 || dataTarget.canComplete) {
          callbacks.onUpdateCompleted(dataTarget, targetElement);
        }
      }
      return;
    }
    const sourceViewport = cornerstone.getViewport(sourceElement);
    const targetViewport = cornerstone.getViewport(targetElement);

    const ratio =
      targetViewport.displayedArea.columnPixelSpacing /
      sourceViewport.displayedArea.columnPixelSpacing;

    const addData = (element: HTMLElement, dataList: RoiData[]) => {
      console.log('addData');
      const image = cornerstone.getImage(element);
      // Get the source and target viewports
      const visible = callbacks.getImageVisibility(element);
      for (const data of dataList) {
        console.log(data, visible);
        const newData = { ...data, visible: data.area < 0.1 || visible };
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
            newData.handles.points = newData.handles.points.map((p) => ({
              ...p,
              x: p.x * ratio,
              y: p.y * ratio,
            }));

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
        // cornerstoneTools.clearToolState(sourceElement, ToolName.FreehandRoi);
        // addData(sourceElement, targetRois);

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
        // } else {
        //   console.log('same size');
        //   for (let i = 0; i < targetRois.length; i++) {
        //     const dataTarget = targetRois[i];
        //     const dataSource = sourceRois[i];

        //     if (dataTarget.area > 0.1 || dataTarget.canComplete) {
        //       const didUpdate = callbacks.onUpdateCompleted(
        //         dataTarget,
        //         targetElement
        //       );
        //       if (didUpdate) {
        //         dataSource.handles.points = dataTarget.handles.points.map(
        //           (p) => ({
        //             ...p,
        //             x: p.x * ratio,
        //             y: p.y * ratio,
        //           })
        //         );
        //         callbacks.onUpdateCompleted(dataSource, sourceElement);
        //       }
        //     } else {
        //       dataSource.visible = true;
        //       dataSource.handles.points = dataTarget.handles.points.map((p) => ({
        //         ...p,
        //         x: p.x * ratio,
        //         y: p.y * ratio,
        //       }));
        //     }
        //   }
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
}

// let _x = Math.round(bbox.left);
// const xs = Array(Math.round(bbox.width)).map((_) => _x++);
// for (let y = bbox.top; y < bbox.top + bbox.height; y++) {
//   this.cornerstoneService
//     .lineInFreehand(y, leftData.points, xs)
//     .map((inFreehand, ii) => {
//       if (inFreehand) {
//         const x = _x[ii];
//         const diff = left[index] - right[index];
//         if (isNaN(diff)) {
//           console.log(
//             x,
//             y,
//             index,
//             left[index],
//             right[index],
//             left.length,
//             right.length
//           );
//         }
//         maxDiff = Math.max(maxDiff, diff);
//         minDiff = Math.min(minDiff, diff);
//         sumDiff += diff;

//         differencePixels.push({
//           left: left[index],
//           right: right[index],
//           index:
//             Math.round(y) * data.dynamicImage.width + Math.round(x),
//           diff,
//         });
//       }
//       index++;
//     });
// }
