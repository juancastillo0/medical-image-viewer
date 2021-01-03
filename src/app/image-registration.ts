import { CornerstoneImage, StackToolState } from './cornerstone-types';
import {
  cornerstone,
  cornerstoneTools,
  cornerstoneWebImageLoader,
} from './cornerstone.service';
import { ImageState } from './image-state';

type TransformationParms = {
  scale: number;
  angle: number;
  deltax: number;
  deltay: number;
  centerx: number;
  centery: number;
};

export class ImageRegistration {
  imageDataLeft: ImageState;
  imageDataRight: ImageState;
  registerMethod: string = '4';
  isLoadingRegistration = false;

  constructor(d: { left: ImageState; right: ImageState }) {
    this.imageDataLeft = d.left;
    this.imageDataRight = d.right;
  }

  selectRegisterMethod = (method: string) => {
    this.registerMethod = method;
  };

  public registerImages = async () => {
    const indexRight = this.imageDataRight.currentStackIndex();
    this.isLoadingRegistration = true;
    try {
      const response = await this.imageRegistration(
        this.imageDataLeft.getElement(),
        this.imageDataRight.getElement(),
        {
          method: this.registerMethod,
        }
      );

      if ('imageId' in response.data) {
        const element = this.imageDataRight.getElement();
        const stackState = (cornerstoneTools.getToolState(
          element,
          'stack'
        ) as StackToolState).data[0];
        stackState.imageIds[indexRight] = response.data.imageId;
        // cornerstoneTools.clearToolState(element, 'stack');
        // cornerstoneTools.addToolState(element, 'stack', stackState);
        cornerstone.updateImage(element, true);
      } else if (!!response.data) {
        const transform = response.data;
        if (transform.scale < 1.5) {
          this.imageDataRight.translateOrRotate({
            x: -this.imageDataRight.dx - transform.deltax,
            y: -this.imageDataRight.dy - transform.deltay,
            angle: -(transform.angle * 180) / Math.PI,
          });
        } else {
          this.imageDataRight.translateOrRotate({
            x: -this.imageDataRight.dx + (transform.centerx - transform.deltax),
            y: -this.imageDataRight.dy + (transform.centery - transform.deltay),
            angle: -(transform.angle * 180) / Math.PI,
          });
        }
      }
    } catch (e) {
      console.log(e);
    } finally {
      this.isLoadingRegistration = false;
    }
  };

  private imageRegistration = async (
    elemLeft: HTMLDivElement,
    elemRight: HTMLDivElement,
    options: { method: string }
  ) => {
    const toBlob = (canvas: HTMLCanvasElement) => {
      return new Promise<Blob | null>((r) => {
        canvas.toBlob(r);
      });
    };
    const imLeft = cornerstone.getImage(elemLeft);
    const imRight = cornerstone.getImage(elemRight);
    const blobs = await Promise.all([
      toBlob(elemLeft.querySelector('canvas')),
      toBlob(elemRight.querySelector('canvas')),
    ]);
    const formData = new FormData();
    // formData.append('cut1', blobs[0]);
    // formData.append('cut2', blobs[1]);
    formData.append(
      'cut1',
      new Blob([((imLeft.getPixelData() as any) as Uint16Array).buffer], {
        type: 'application/octet-stream',
      })
    );
    formData.append(
      'cut2',
      new Blob([((imRight.getPixelData() as any) as Uint16Array).buffer], {
        type: 'application/octet-stream',
      })
    );

    const queryParams = `?lw=${imLeft.width}&lh=${imLeft.height}&rw=${imRight.width}&rh=${imRight.height}&method=${options.method}`;

    const response = await fetch(
      `http://127.0.0.1:5000/files/registration${queryParams}`,
      {
        method: 'POST',
        body: formData,
      }
    );

    let data: CornerstoneImage | TransformationParms;
    if (response.ok) {
      console.log(response);
      console.log(response.headers.get('Content-Type'));
      if (response.headers.get('Content-Type') === 'application/json') {
        data = await response.json();
      } else {
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        data = await cornerstoneWebImageLoader.loadImage(blobUrl).promise;
      }
      console.log(data);
    }
    return { response, data };
  };
}
