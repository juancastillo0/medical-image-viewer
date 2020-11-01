import { TestBed } from '@angular/core/testing';

import { ImageMetadataService } from './image-metadata.service';

describe('ImageMetadataService', () => {
  let service: ImageMetadataService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImageMetadataService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
