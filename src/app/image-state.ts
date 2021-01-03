import * as dicomParser from 'dicom-parser';
import { HistogramRegion } from './app.component';
import {
  CornerstoneImage,
  Offset,
  RoiData,
  StackToolState,
} from './cornerstone-types';
import { cornerstone, cornerstoneTools, ToolName } from './cornerstone.service';
import { BBox, getBoundingBox } from './utils';

export type ParsingResult =
  | {
      warnings: string[];
      pixelData?: dicomParser.Element;
      info: { [key: string]: string };
      filteredInfo: { [key: string]: string };
    }
  | {
      parsingError: string;
    };

export type DiffPoint = {
  x: number;
  y: number;
  left: number;
  right: number;
  index: number;
  diff: number;
};

export type DiffData = {
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

export class ImageState {
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
  opacity = 0.7;
  angle = 0;
  dx = 0;
  dy = 0;

  stackPosition?: number;
  stackSize?: number;
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

  translateOrRotate = (d: { x?: number; y?: number; angle?: number }) => {
    const element = this.getElement();
    const viewport = cornerstone.getViewport(element);
    this.angle = d.angle ?? viewport.rotation;
    this.dx = this.dx + (d.x ?? 0);
    this.dy = this.dy + (d.y ?? 0);

    viewport.rotation = this.angle;
    viewport.translation.x += d.x ?? 0;
    viewport.translation.y += d.y ?? 0;

    cornerstone.setViewport(element, viewport);
    cornerstone.updateImage(element);
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
