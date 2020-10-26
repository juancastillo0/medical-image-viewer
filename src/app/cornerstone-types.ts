export type RoiData = {
  active: boolean;
  area: number;
  canComplete: boolean;
  color?: any;
  handles: {
    invalidHandlePlacement: boolean;
    points: {
      x: number;
      y: number;
      highlight: boolean;
      active: boolean;
      lines: { x: number; y: number }[];
    };
  };
  textBox: {
    active: boolean;
    hasMoved: boolean;
    movesIndependently: boolean;
    drawnIndependently: boolean;
    allowedOutsideImage: boolean;
  };
  highlight: boolean;
  invalidated: boolean;
  meanStdDev: {
    count: number;
    mean: number;
    variance: number;
    stdDev: number;
  };
  meanStdDevSUV?: any;
  polyBoundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  unit: string;
  uuid: string;
  visible: boolean;
};

type ElementCallback = (element: HTMLElement) => void;

export type Synchronizer = {
  add: ElementCallback;
  addSource: ElementCallback;
  addTarget: ElementCallback;
  destroy: () => void;
  displayImage: (element: HTMLElement, image, viewport) => void;
  enabled: boolean;
  fireEvent: (sourceElement: HTMLElement, eventData) => void;
  getDistances: () => void;
  getHandler: () => void;
  getSourceElements: () => void;
  getTargetElements: () => void;
  onEvent: (e) => void;
  remove: ElementCallback;
  removeSource: ElementCallback;
  removeTarget: ElementCallback;
  setHandler: (handler) => void;
  setViewport: (element: HTMLElement, viewport) => void;
  updateDisableHandlers: () => void;
};

export type SynchronizerCallback = (
  synchronizer: Synchronizer,
  sourceElement: HTMLElement,
  targetElement: HTMLElement,
  eventData?: any
) => void;

type SetToolModeCallback = (
  toolName: string,
  options: object | number
) => undefined;

type SetToolModeForElementCallback = (
  element: HTMLElement,
  toolName: string,
  options: object | number
) => undefined;

type CornerstoneTool = {
  activeStrategy?: any;
  defaultStrategy?: any;
  element?: HTMLElement;
  hideDefaultCursor: boolean;
  initialConfiguration: {
    name: string;
    supportedInteractionTypes: string[];
    configuration: object;
    svgCursor: any;
    synchronizationContext: Synchronizer;
  };
  isMultiPartTool: boolean;
  mode: 'disabled' | 'active' | 'passive' | 'enabled';
  name: string;
  strategies: object;
  supportedInteractionTypes: string[];
  svgCursor: any;
  updateOnMouseMove: boolean;
};

export type CornerstoneToolsModule = {
  SaveAs: any;
  EVENTS: any;
  AngleTool: any;
  ArrowAnnotateTool: any;
  BidirectionalTool: any;
  BrushTool: any;
  CircleRoiTool: any;
  CircleScissorsTool: any;
  CobbAngleTool: any;
  CorrectionScissorsTool: any;
  CrosshairsTool: any;
  DoubleTapFitToWindowTool: any;
  DragProbeTool: any;
  EllipticalRoiTool: any;
  EraserTool: any;
  FreehandRoiSculptorTool: any;
  FreehandRoiTool: any;
  FreehandScissorsTool: any;
  LengthTool: any;
  MagnifyTool: any;
  OrientationMarkersTool: any;
  OverlayTool: any;
  PanMultiTouchTool: any;
  PanTool: any;
  ProbeTool: any;
  RectangleRoiTool: any;
  RectangleScissorsTool: any;
  ReferenceLinesTool: any;
  RotateTool: any;
  RotateTouchTool: any;
  ScaleOverlayTool: any;
  SphericalBrushTool: any;
  StackScrollMouseWheelTool: any;
  StackScrollMultiTouchTool: any;
  StackScrollTool: any;
  Synchronizer: any;
  TextMarkerTool: any;
  WwwcRegionTool: any;
  WwwcTool: any;
  ZoomMouseWheelTool: any;
  ZoomTool: any;
  ZoomTouchPinchTool: any;
  addStackStateManager: (element: HTMLElement, otherTools) => void;
  addTool: (ApiTool: any, props?) => void;
  addToolForElement: (element: HTMLElement, ApiTool: any, props?) => void;
  addToolState: (
    element: HTMLElement,
    toolName: string,
    measurementData
  ) => void;
  clearToolState: (element: HTMLElement, toolName: string) => void;
  disableLogger: () => void;
  enableLogger: () => void;
  external: any;
  forceEnabledElementResize: () => void;
  getElementToolStateManager: (element: HTMLElement) => any;
  getModule: (moduleName: string) => any;
  getToolForElement: (element: HTMLElement, name: string) => CornerstoneTool;
  getToolState: (element: HTMLElement, toolName: string) => any;
  globalFrameOfReferenceSpecificToolStateManager: object;
  globalImageIdSpecificToolStateManager: object;
  import: (uri) => void;
  importInternal: (uri) => void;
  init: () => void;
  isToolActiveForElement: (element: HTMLElement, name: string) => void;
  loadHandlerManager: object;
  newFrameOfReferenceSpecificToolStateManager: () => void;
  newImageIdSpecificToolStateManager: () => void;
  newStackSpecificToolStateManager: (toolNames, oldStateManager) => void;
  orientation: object;
  panZoomSynchronizer: SynchronizerCallback;
  playClip: (element: HTMLElement, framesPerSecond) => void;
  register: (type, name, item) => void;
  registerSome: (items) => void;
  removeTool: (toolName: string) => void;
  removeToolForElement: (element: HTMLElement, toolName: string) => void;
  removeToolState: (element: HTMLElement, toolName: string, data) => void;
  requestPoolManager: object;
  setElementToolStateManager: (element: HTMLElement, toolStateManager) => void;
  setToolActive: (
    toolName: string,
    options?: object | string[] | number,
    interactionTypes?: string[]
  ) => void;
  setToolActiveForElement: (
    element: HTMLElement,
    toolName: string,
    options?: object | string[] | number,
    interactionTypes?: string[]
  ) => void;
  setToolDisabled: SetToolModeCallback;
  setToolDisabledForElement: SetToolModeForElementCallback;
  setToolEnabled: SetToolModeCallback;
  setToolEnabledForElement: SetToolModeForElementCallback;
  setToolOptions: SetToolModeCallback;
  setToolOptionsForElement: SetToolModeForElementCallback;
  setToolPassive: SetToolModeCallback;
  setToolPassiveForElement: SetToolModeForElementCallback;
  stackImageIndexSynchronizer: SynchronizerCallback;
  stackImagePositionOffsetSynchronizer: (
    synchronizer: Synchronizer,
    sourceElement: HTMLElement,
    targetElement: HTMLElement,
    eventData,
    positionDifference
  ) => void;
  stackImagePositionSynchronizer: SynchronizerCallback;
  stackPrefetch: object;
  stackRenderers: object;
  stackScrollSynchronizer: SynchronizerCallback;
  stackSpecificStateManager: object;
  stopClip: ElementCallback;
  store: object;
  textStyle: object;
  toolColors: object;
  toolCoordinates: object;
  toolStyle: object;
  updateImageSynchronizer: SynchronizerCallback;
  version: '4.22.0';
  wwwcSynchronizer: SynchronizerCallback;
};

type Offset = { x: number; y: number };

type Viewport = {
  colormap?: any;
  displayedArea: {
    tlhc: Offset;
    brhc: Offset;
    rowPixelSpacing: number;
    columnPixelSpacing: number;
    presentationSizeMode: string;
  };
  hflip: boolean;
  invert: boolean;
  labelmap: boolean;
  modalityLUT?: any;
  pixelReplication: boolean;
  rotation: number;
  scale: number;
  translation: Offset;
  vflip: boolean;
  voi: { windowWidth: number; windowCenter: number };
  voiLUT?: any;
};

type CornerstoneImage = {
  cachedLut: any;
  color: boolean;
  columnPixelSpacing: number;
  columns: number;
  data?: any;
  decodeTimeInMS: number;
  floatPixelData?: any;
  getPixelData: () => any;
  height: number;
  imageId: string;
  intercept: number;
  invert: boolean;
  maxPixelValue: number;
  minPixelValue: number;
  rowPixelSpacing: number;
  rows: number;
  sharedCacheKey?: string;
  sizeInBytes: number;
  slope: number;
  stats: {
    lastGetPixelDataTime: number;
    lastStoredPixelDataToCanvasImageDataTime: number;
    lastPutImageDataTime: number;
    lastRenderTime: number;
    lastLutGenerateTime: number;
  };
  loadTimeInMS?: number;
  totalTimeInMS?: number;
  width: number;
  windowCenter: number;
  windowWidth: number;
};

type CornerstoneLayer = {};

export type CornerstoneModule = {
  EVENTS: object;
  addEnabledElement: ElementCallback;
  addLayer: (element: HTMLElement, image, options?) => void;
  canvasToPixel: (element: HTMLElement, pt) => any;
  colors: object;
  convertImageToFalseColorImage: (image, colormap) => void;
  convertToFalseColorImage: (element: HTMLElement, colormap) => void;
  disable: ElementCallback;
  displayImage: (element: HTMLElement, image, viewport) => void;
  draw: ElementCallback;
  drawImage: ElementCallback;
  drawInvalidated: () => void;
  enable: (element: HTMLElement, options?) => void;
  events: EventTarget;
  fitToWindow: ElementCallback;
  generateLut: (
    image,
    windowWidth,
    windowCenter,
    invert,
    modalityLUT,
    voiLUT
  ) => any;
  getActiveLayer: (element: HTMLElement) => any;
  getDefaultViewport: (canvas, image) => Viewport;
  getDefaultViewportForImage: (element: HTMLElement, image) => Viewport;
  getElementData: (element: HTMLElement, dataType) => any;
  getEnabledElement: (element: HTMLElement) => any;
  getEnabledElements: () => HTMLElement[];
  getEnabledElementsByImageId: (imageId: string) => HTMLElement[];
  getImage: (element: HTMLElement) => CornerstoneImage;
  getLayer: (element: HTMLElement, layerId) => CornerstoneLayer;
  getLayers: (element: HTMLElement) => CornerstoneLayer[];
  getPixels: (
    element: HTMLElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) => any;
  getStoredPixels: (
    element: HTMLElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) => any;
  getViewport: (element: HTMLElement) => Viewport;
  getVisibleLayers: (element: HTMLElement) => CornerstoneLayer[];
  imageCache: object;
  internal: object;
  invalidate: ElementCallback;
  invalidateImageId: (imageId: string) => void;
  loadAndCacheImage: (imageId: string, options?) => any;
  loadImage: (imageId: string, options?) => Promise<CornerstoneImage>;
  metaData: any;
  pageToPixel: (element: HTMLElement, pageX, pageY) => any;
  pixelDataToFalseColorData: (image, lookupTable) => void;
  pixelToCanvas: (element: HTMLElement, pt) => any;
  purgeLayers: (element: HTMLElement) => void;
  registerImageLoader: (scheme, imageLoader) => void;
  registerUnknownImageLoader: (imageLoader) => void;
  removeElementData: (element: HTMLElement, dataType) => void;
  removeLayer: (element: HTMLElement, layerId) => void;
  renderColorImage: (enabledElement: HTMLElement, invalidated) => void;
  renderGrayscaleImage: (enabledElement: HTMLElement, invalidated) => void;
  renderLabelMapImage: (enabledElement: HTMLElement, invalidated) => void;
  renderPseudoColorImage: (enabledElement: HTMLElement, invalidated) => void;
  renderToCanvas: (canvas, image) => void;
  renderWebImage: (enabledElement: HTMLElement, invalidated) => void;
  rendering: object;
  reset: ElementCallback;
  resize: (element: HTMLElement, forceFitToWindow) => void;
  restoreImage: (image) => void;
  setActiveLayer: (element: HTMLElement, layerId) => void;
  setDefaultViewport: (viewport: Viewport) => void;
  setLayerImage: (element: HTMLElement, image, layerId) => void;
  setToPixelCoordinateSystem: (
    enabledElement: HTMLElement,
    context,
    scale
  ) => void;
  setViewport: (element: HTMLElement, viewport) => void;
  storedColorPixelDataToCanvasImageData: (
    image,
    lut,
    canvasImageDataData
  ) => any;
  storedPixelDataToCanvasImageData: (image, lut, canvasImageDataData) => any;
  storedPixelDataToCanvasImageDataColorLUT: (
    image,
    colorLut,
    canvasImageDataData
  ) => any;
  storedPixelDataToCanvasImageDataPseudocolorLUT: (
    image,
    grayscaleLut,
    colorLut,
    canvasImageDataData
  ) => any;
  triggerEvent: (el, type) => void;
  updateImage: (element: HTMLElement) => void;
  webGL: object;
};
