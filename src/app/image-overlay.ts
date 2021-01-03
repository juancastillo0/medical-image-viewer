import { cornerstone, CornerstoneService } from './cornerstone.service';
import { DiffData, DiffPoint, ImageState } from './image-state';
import { resizeImage } from './resize-image';
import { BBox, rescaleBoundingBox, roisAreEqual } from './utils';
import * as tf from '@tensorflow/tfjs';
import { CornerstoneImage } from './cornerstone-types';

export class ImageOverlay {
  updateVolumeStats: () => void;
  getTranslation: (
    source: HTMLElement,
    target: HTMLElement
  ) => { dx: number; dy: number };

  constructor(
    public cornerstoneService: CornerstoneService,
    p: {
      updateVolumeStats: () => void;
      getTranslation: (
        source: HTMLElement,
        target: HTMLElement
      ) => { dx: number; dy: number };
    }
  ) {
    this.updateVolumeStats = p.updateVolumeStats;
    this.getTranslation = p.getTranslation;
  }

  createOverlayImage = (
    firstImage: CornerstoneImage,
    data: ImageState,
    otherData: ImageState
  ): CornerstoneImage => {
    return {
      imageId: data.getElement().id,
      minPixelValue: 0,
      maxPixelValue: 255,
      slope: 1.0,
      intercept: 0,
      windowCenter: firstImage.width / 2,
      windowWidth: firstImage.width,
      getPixelData: this.createGetPixelData(data, otherData),
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
  };

  private createGetPixelData = (
    data: ImageState,
    otherData: ImageState
  ): (() => number[]) => {
    return () => {
      const _curr = data.currentStackPoints();
      const dataList = data.getRoiPixels();
      if (dataList.length === 0) {
        return data.dynamicImage.data.rawPixels;
      }
      const rawPixels = new Uint8Array(
        data.dynamicImage.height * data.dynamicImage.width
      );

      const translatePoints = this.cornerstoneService.buildTranslatePoints(
        otherData.getElement(),
        data.getElement(),
        this.getTranslation
      );
      const ratio = this.cornerstoneService.calculateScaleRatio(
        otherData.getElement(),
        data.getElement()
      );
      const imageDataLeft = data.isLeft ? data : otherData;

      for (let i = 0; i < dataList.length; i++) {
        const roi = dataList[i];
        let diffData: DiffData = _curr[roi.uuid].diffData;
        console.log(roi.bbox);

        if (
          diffData?.imageId !== imageDataLeft.imageId ||
          !roisAreEqual(diffData?.points, roi.points)
        ) {
          const otherBbox: BBox = rescaleBoundingBox(roi.bbox, translatePoints);

          let otherPixels: number[] | tf.TypedArray = cornerstone.getPixels(
            otherData.getElement(),
            otherBbox.left,
            otherBbox.top,
            otherBbox.width,
            otherBbox.height
          );
          let pixels: number[] | tf.TypedArray = roi.pixels;

          let bbox: BBox = roi.bbox;
          let points = roi.points;
          if (ratio !== 1) {
            // if (roi.bbox.width > otherBbox.width) {
            const tensor = resizeImage(
              otherPixels,
              { h: otherBbox.height, w: otherBbox.width },
              { w: roi.bbox.width, h: roi.bbox.height }
            );
            // console.log("max tensor ",data.getElement().id, tensor.max().dataSync());
            // console.log("min tensor", data.getElement().id,tensor.min().dataSync());
            otherPixels = tensor.dataSync();
            // } else {
            //   bbox = otherBbox;
            //   points = roi.points.map((p) => ({
            //     x: p.x * ratio,
            //     y: p.y * ratio,
            //   }));
            //   pixels = resizeImage(
            //     pixels,
            //     { w: roi.bbox.width, h: roi.bbox.height },
            //     { h: otherBbox.height, w: otherBbox.width }
            //   ).dataSync();
            // }
          }

          let left: number[] | tf.TypedArray;
          let right: number[] | tf.TypedArray;
          if (data.isLeft) {
            left = pixels;
            right = otherPixels;
          } else {
            right = pixels;
            left = otherPixels;
          }

          let index = 0;
          const differencePixels: Array<DiffPoint> = [];
          let maxDiff = Number.MIN_VALUE;
          let minDiff = Number.MAX_VALUE;
          let sumDiff = 0;
          for (let y = bbox.top; y < bbox.top + bbox.height; y++) {
            for (let x = bbox.left; x < bbox.left + bbox.width; x++) {
              const inFreehand = this.cornerstoneService.pointInFreehand2(
                points,
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

                differencePixels.push({
                  left: left[index],
                  right: right[index],
                  index: y * data.dynamicImage.width + x,
                  diff,
                  x,
                  y,
                });
              }
              index++;
            }
          }
          // const ordered = differencePixels.sort((a, b) => a.diff - b.diff);
          // const p5 = ordered[Math.ceil(ordered.length * 0.05)];
          // const p95 = ordered[Math.floor(ordered.length * 0.95)];
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
        console.log('max', diffData.max, 'min', diffData.min);
        for (const p of diffData.array) {
          // if (p.diff > diffData.max) {
          //   p.diff = diffData.max;
          // } else if (p.diff < diffData.min) {
          //   p.diff = diffData.min;
          // }
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
}
