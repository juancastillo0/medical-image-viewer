import { TestBed } from '@angular/core/testing';

import { CornerstoneService } from './cornerstone.service';

describe('CornerstoneService', () => {
  let service: CornerstoneService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CornerstoneService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
