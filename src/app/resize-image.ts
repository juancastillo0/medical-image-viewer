import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { CornerstoneImage } from './cornerstone-types';

setWasmPaths(`${document.location.href}assets/`);
tf.setBackend('wasm').then((loadedTFWasm) => {
  console.log('loadedTFWasm: ', loadedTFWasm);
});

export const resizeImage = (
  imagePixels: Array<number>,
  size: { h: number; w: number },
  newSize: { h: number; w: number }
): tf.Tensor3D => {
  const imageTensor = tf.tidy(() => {
    const tensor = tf.tensor3d(
      Array.from(imagePixels),
      [size.h, size.w, 1],
      'float32'
    );
    return tf.image.resizeBilinear(tensor, [newSize.h, newSize.w]);
  });
  return imageTensor;
};

type ImageBufferType = 'uint16' | 'uint32' | 'uint8';
type ImageBuffer = Uint8Array | Uint16Array | Uint32Array;
type ImageBufferConstructor =
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor;

const imageBufferTypeMap: {
  [key in ImageBufferType]: ImageBufferConstructor;
} = {
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
};

export const resizeCornerstoneImage = (
  image: CornerstoneImage,
  newSize: { h: number; w: number }
): CornerstoneImage => {
  const pixelData = image.getPixelData();
  let type: ImageBufferType;
  if (pixelData instanceof Uint8Array) {
    type = 'uint8';
  } else if (pixelData instanceof Uint16Array) {
    type = 'uint16';
  } else if (pixelData instanceof Uint32Array) {
    type = 'uint32';
  }

  const resizedTensor = resizeImage(
    pixelData,
    { h: image.height, w: image.width },
    newSize
  );
  const resizedImage: ImageBuffer = imageBufferTypeMap[type].from(
    resizedTensor.dataSync()
  );

  return {
    ...image,
    getPixelData: () => resizedImage as any,
    columnPixelSpacing: (image.columnPixelSpacing * image.width) / newSize.w,
    rowPixelSpacing: (image.rowPixelSpacing * image.height) / newSize.h,
    sizeInBytes:
      image.sizeInBytes *
      (newSize.w / image.width) *
      (newSize.h / image.height),
    height: newSize.h,
    rows: newSize.h,
    width: newSize.w,
    columns: newSize.w,
  };
};

(window as any).resizeImage = resizeImage;
(window as any).resizeCornerstoneImage = resizeCornerstoneImage;
(window as any).tf = tf;
