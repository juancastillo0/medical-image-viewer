import embed, { VisualizationSpec } from 'vega-embed';
import { HistogramRegion } from './app.component';
import { DiffPoint, ImageState } from './image-state';

type ImageVolumeStats = {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  meanLeft: number;
  meanRight: number;
  stdLeft: number;
  stdRight: number;
  areaLeft: number;
  areaRight: number;
  meanLeftOwn: number;
  meanRightOwn: number;
  stdLeftOwn: number;
  stdRightOwn: number;
};

export class ImageStats {
  HistogramRegion = HistogramRegion;

  imageDataLeft: ImageState;
  imageDataRight: ImageState;
  selectedHistogramRegion: HistogramRegion = HistogramRegion.lastRoi;
  selectedSide: ImageState;
  volumeStats?: ImageVolumeStats;

  constructor(d: { left: ImageState; right: ImageState }) {
    this.imageDataLeft = d.left;
    this.imageDataRight = d.right;
  }

  updateHistogramRegion(histRegion: HistogramRegion, lastRoiUuid: string) {
    this.selectedHistogramRegion = histRegion;
    this.updateVolumeStats(lastRoiUuid);
  }

  setSelectedSide = (side: ImageState) => {
    this.selectedSide = side;
  };

  updateVolumeStats = (lastRoiUuid: string) => {
    const difListLeft = this.imageDataLeft.getData(
      this.selectedHistogramRegion,
      lastRoiUuid
    );
    const difListRight = this.imageDataRight.getData(
      this.selectedHistogramRegion,
      lastRoiUuid
    );
    if (difListLeft.length === 0 && difListRight.length === 0) {
      return;
    }

    let _baseDiffPoints: DiffPoint[];
    let _isOnlySide: null | 'left' | 'right' = null;
    if (this.selectedHistogramRegion === HistogramRegion.lastRoi) {
      if (this.selectedSide.isLeft) {
        _baseDiffPoints = difListLeft.flatMap((p) => p.diffData.array);
        _isOnlySide = 'left';
      } else {
        _baseDiffPoints = difListRight.flatMap((p) => p.diffData.array);
        _isOnlySide = 'right';
      }
    } else {
      _baseDiffPoints = difListLeft
        .flatMap((p) => p.diffData.array)
        .concat(difListRight.flatMap((p) => p.diffData.array));
    }

    const diffPoints = [
      ..._baseDiffPoints
        .reduce((m, p) => {
          m.set(`${p.x}_${p.y}`, p);
          return m;
        }, new Map<string, DiffPoint>())
        .values(),
    ];
    this.drawHistogram(diffPoints);

    const stats = diffPoints.reduce(
      (previous, p) => {
        previous.sumLeft += p.left;
        previous.sumRight += p.right;
        previous.sumDiff += p.diff;

        previous.minLeft = Math.min(previous.minLeft, p.left);
        previous.maxLeft = Math.max(previous.maxLeft, p.left);
        previous.minRight = Math.min(previous.minRight, p.right);
        previous.maxRight = Math.max(previous.maxRight, p.right);
        previous.minDiff = Math.min(previous.minDiff, p.diff);
        previous.maxDiff = Math.max(previous.maxDiff, p.diff);
        return previous;
      },
      {
        sumDiff: 0,
        sumLeft: 0,
        sumRight: 0,
        minLeft: Number.MAX_VALUE,
        maxLeft: Number.MIN_VALUE,
        minRight: Number.MAX_VALUE,
        maxRight: Number.MIN_VALUE,
        minDiff: Number.MAX_VALUE,
        maxDiff: Number.MIN_VALUE,
      }
    );
    const diffMean = stats.sumDiff / diffPoints.length;
    const leftMean = stats.sumLeft / diffPoints.length;
    const rightMean = stats.sumRight / diffPoints.length;

    const diffVariance = diffPoints.reduce(
      (previous, p) => {
        previous.diff += Math.pow(p.diff - diffMean, 2);
        previous.left += Math.pow(p.left - leftMean, 2);
        previous.right += Math.pow(p.right - rightMean, 2);
        return previous;
      },
      { left: 0, right: 0, diff: 0 }
    );

    const _sideStats = (data: ImageState) => {
      return data.getData(this.selectedHistogramRegion, lastRoiUuid).reduce(
        (previous, { stats }) => {
          previous.sum += stats.mean * stats.count;
          previous.count += stats.count;
          previous.varianceSum += stats.variance * stats.count;
          previous.area += stats.area;
          return previous;
        },
        {
          count: 0,
          sum: 0,
          varianceSum: 0,
          area: 0,
        }
      );
    };
    const statsLeft = _sideStats(this.imageDataLeft);
    const statsRight = _sideStats(this.imageDataRight);

    const toStr = (v: number) => Number.parseFloat(v.toFixed(1));

    if (diffPoints.length > 0) {
      this.volumeStats = {
        ...stats,

        count: diffPoints.length,
        max: stats.maxDiff,
        min: stats.minDiff,
        sum: stats.sumDiff,

        //
        mean: toStr(diffMean),
        std: toStr(Math.sqrt(diffVariance.diff / diffPoints.length)),
        //
        meanLeft: toStr(leftMean),
        stdLeft: toStr(Math.sqrt(diffVariance.left / diffPoints.length)),
        //
        meanRight: toStr(rightMean),
        stdRight: toStr(Math.sqrt(diffVariance.right / diffPoints.length)),

        //
        areaLeft:
          _isOnlySide === 'right'
            ? toStr(statsRight.area)
            : toStr(statsLeft.area),
        areaRight:
          _isOnlySide === 'left'
            ? toStr(statsLeft.area)
            : toStr(statsRight.area),

        //
        meanLeftOwn: toStr(statsLeft.sum / statsLeft.count),
        stdLeftOwn: toStr(Math.sqrt(statsLeft.varianceSum / statsLeft.count)),
        //
        meanRightOwn: toStr(statsRight.sum / statsRight.count),
        stdRightOwn: toStr(
          Math.sqrt(statsRight.varianceSum / statsRight.count)
        ),
      };
    }
  };

  private drawHistogram = (points: DiffPoint[]): void => {
    const data = [
      ...points.map((p) => ({
        intensity: p.left,
        type: 'Left',
      })),
      ...points.map((p) => ({
        intensity: p.right,
        type: 'Right',
      })),
    ];

    const specDist: VisualizationSpec = {
      width: 600,
      height: 180,
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
        x: {
          bin: { binned: true },
          field: 'Binned',
          type: 'quantitative',
          axis: {
            title: 'Intensity',
          },
        },
        x2: {
          field: 'Binned_end',
        },
        y: {
          field: 'RelativeCount',
          type: 'quantitative',
          axis: {
            title: 'Percentage',
          },
        },
        color: {
          field: 'type',
          scale: { range: ['#675193', '#ca8861'] },
          legend: { orient: 'bottom' },
        },
        opacity: { value: 0.6 },
      },
    };

    embed('#distChart', specDist);

    const specDiff: VisualizationSpec = {
      width: 600,
      height: 180,
      data: {
        values: points.map((p) => ({
          delta: p.diff,
        })),
      },
      mark: 'bar',
      encoding: {
        x: {
          field: 'delta',
          bin: true,
          axis: {
            title: 'Intensity Difference (Left - Right)',
          },
        },
        y: {
          aggregate: 'count',
          stack: null,
          axis: {
            title: 'Pixel Count',
          },
        },
        color: {
          field: 'delta',
          type: 'quantitative',
          bin: true,
          legend: null,
        },
      },
    };

    embed('#diffChart', specDiff);
  };
}
