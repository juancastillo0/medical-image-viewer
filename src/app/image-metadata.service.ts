import { Injectable } from '@angular/core';
import * as dicomParser from 'dicom-parser';
import { CornerstoneService } from './cornerstone.service';

export type ImageMetadata = ReturnType<ImageMetadataService['getDicomSummary']>;

@Injectable({
  providedIn: 'root',
})
export class ImageMetadataService {
  constructor(private cornerstone: CornerstoneService) {}

  getDicomSummary = (
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
      this.cornerstone.cornerstone.metaData.get(type, imageId);

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
    Object.entries(getMetaData('imagePlaneModule')).forEach(([key, value]) => {
      if (key !== 'frameOfReferenceUID') {
        summary[key] = '' + value;
      }
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
