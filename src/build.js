const fs = require("fs");

const emscriptenPath = "node_modules/@types/emscripten/index.d.ts";
const emscriptenFile = fs.readFileSync(emscriptenPath, "utf-8");

const emscriptenModuleStr = `
declare module 'emscripten' {
  interface EmscriptenModule {

      print(str: string): void;
      printErr(str: string): void;
      arguments: string[];
      environment: Emscripten.EnvironmentType;
      preInit: { ():  void }[];
      preRun: { ():  void }[];
      postRun: { ():  void }[];
      preinitializedWebGLContext: WebGLRenderingContext;
      noInitialRun: boolean;
      noExitRuntime: boolean;
      logReadFiles: boolean;
      filePackagePrefixURL: string;
      wasmBinary: ArrayBuffer;
  
      destroy(object: object): void;
      getPreloadedPackage(remotePackageName: string, remotePackageSize: number): ArrayBuffer;
      instantiateWasm(
          imports: Emscripten.WebAssemblyImports,
          successCallback: (module: WebAssembly.Module) => void
      ): Emscripten.WebAssemblyExports;
      locateFile(url: string): string;
      onCustomMessage(event: MessageEvent): void;
  
      Runtime: any;
  
      ccall(ident: string, returnType: string | null, argTypes: string[], args: any[]): any;
      cwrap(ident: string, returnType: string | null, argTypes: string[]): any;
  
      setValue(ptr: number, value: any, type: string, noSafe?: boolean): void;
      getValue(ptr: number, type: string, noSafe?: boolean): number;
  
      ALLOC_NORMAL: number;
      ALLOC_STACK: number;
      ALLOC_STATIC: number;
      ALLOC_DYNAMIC: number;
      ALLOC_NONE: number;
  
      allocate(slab: any, types: string, allocator: number, ptr: number): number;
      allocate(slab: any, types: string[], allocator: number, ptr: number): number;
  
      Pointer_stringify(ptr: number, length?: number): string;
      UTF8ToString(ptr: number, length?: number): string;
      UTF16ToString(ptr: number): string;
      stringToUTF16(str: string, outPtr: number): void;
      UTF32ToString(ptr: number): string;
      stringToUTF32(str: string, outPtr: number): void;
  
      // USE_TYPED_ARRAYS == 1
      HEAP: Int32Array;
      IHEAP: Int32Array;
      FHEAP: Float64Array;
  
      // USE_TYPED_ARRAYS == 2
      HEAP8: Int8Array;
      HEAP16: Int16Array;
      HEAP32: Int32Array;
      HEAPU8:  Uint8Array;
      HEAPU16: Uint16Array;
      HEAPU32: Uint32Array;
      HEAPF32: Float32Array;
      HEAPF64: Float64Array;
  
      TOTAL_STACK: number;
      TOTAL_MEMORY: number;
      FAST_MEMORY: number;
  
      addOnPreRun(cb: () => any): void;
      addOnInit(cb: () => any): void;
      addOnPreMain(cb: () => any): void;
      addOnExit(cb: () => any): void;
      addOnPostRun(cb: () => any): void;
  
      // Tools
      intArrayFromString(stringy: string, dontAddNull?: boolean, length?: number): number[];
      intArrayToString(array: number[]): string;
      writeStringToMemory(str: string, buffer: number, dontAddNull: boolean): void;
      writeArrayToMemory(array: number[], buffer: number): void;
      writeAsciiToMemory(str: string, buffer: number, dontAddNull: boolean): void;
  
      addRunDependency(id: any): void;
      removeRunDependency(id: any): void;
  
  
      preloadedImages: any;
      preloadedAudios: any;
  
      _malloc(size: number): number;
      _free(ptr: number): void;
  }
}
`;

fs.writeFileSync(emscriptenPath, emscriptenFile + emscriptenModuleStr, "utf-8");

const wasmPath =
  "node_modules/@tensorflow/tfjs-backend-wasm/wasm-out/tfjs-backend-wasm.d.ts";
const fileWasm = fs.readFileSync(wasmPath, "utf-8");

fs.writeFileSync(
  wasmPath,
  'import {EmscriptenModule} from "emscripten";\n' + fileWasm,
  "utf-8"
);

const cornerstoneWADOImageLoaderPackageJson = String.raw`
{
  "name": "cornerstone-wado-image-loader",
  "version": "2.2.4",
  "description": "Cornerstone ImageLoader for DICOM WADO-URI",
  "keywords": [
    "DICOM",
    "WADO",
    "cornerstone",
    "medical",
    "imaging"
  ],
  "author": "Chris Hafey",
  "homepage": "https://github.com/cornerstonejs/cornerstoneWADOImageLoader",
  "license": "MIT",
  "main": "./dist/cornerstoneWADOImageLoader.js",
  "module": "./dist/cornerstoneWADOImageLoader.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/cornerstonejs/cornerstoneWADOImageLoader.git"
  },
  "scripts": {
    "build": "npm run prebuild && npm run build:es6",
    "build:es6": "npm run test && npm run version && npm run webpack && npm run doc:generate",
    "build:codecs": "npm run concat:codecs && npm run uglify:codecs",
    "clean": "npm run clean:dist && npm run clean:coverage",
    "clean:dist": "shx rm -rf dist",
    "clean:docs": "shx rm -rf documentation",
    "clean:coverage": "shx rm -rf coverage",
    "concat:codecs": "node scripts/concatCodecs.js",
    "doc": "npm run doc:generate && opn documentation/index.html",
    "doc:generate": "npm run clean:docs && jsdoc -c .jsdocrc",
    "eslint": "eslint -c .eslintrc.js src",
    "eslint-quiet": "eslint -c .eslintrc.js --quiet src",
    "eslint-fix": "eslint -c .eslintrc.js --fix src",
    "prebuild": "npm run clean:dist && npm run webpack && npm run build:codecs",
    "start": "npm run webpack && npm run build:codecs",
    "start:dev": "webpack-dev-server --config ./config/webpack/webpack-dev",
    "test": "npm run prebuild && npm run test:chrome",
    "test:all": "npm run test && npm run test:chrome && npm run test:firefox",
    "test:chrome": "karma start config/karma/karma-chrome.js",
    "test:firefox": "karma start config/karma/karma-firefox.js",
    "test:watch": "karma start config/karma/karma-watch.js",
    "uglify:codecs": "uglifyjs --comments /^/\\*!/ --stats -o ./dist/cornerstoneWADOImageLoaderCodecs.min.js -- ./dist/cornerstoneWADOImageLoaderCodecs.js",
    "version": "node -p -e \"'export default \\'' + require('./package.json').version + '\\';'\" > src/version.js",
    "watch": "npm run clean && shx mkdir dist && npm run concat:codecs && npm run webpack:watch",
    "webpack": "npm run webpack:prod && npm run webpack:dev",
    "webpack:dev": "webpack --progress --config ./config/webpack/webpack-dev",
    "webpack:prod": "webpack --progress --config ./config/webpack/webpack-prod",
    "webpack:watch": "webpack --progress --debug --watch  --config ./config/webpack"
  },
  "devDependencies": {
    "@babel/core": "^7.1.2",
    "@babel/plugin-proposal-object-rest-spread": "^7.0.0",
    "@babel/preset-env": "^7.1.0",
    "babel-eslint": "^10.0.1",
    "babel-loader": "^8.0.4",
    "chai": "^4.2.0",
    "concat": "^1.0.3",
    "cornerstone-core": "^2.2.7",
    "coveralls": "^3.0.2",
    "docdash": "^1.0.0",
    "eslint": "^5.8.0",
    "eslint-loader": "^2.1.1",
    "eslint-plugin-import": "^2.14.0",
    "fs-extra": "^7.0.0",
    "istanbul-instrumenter-loader": "^3.0.1",
    "jsdoc": "^3.5.5",
    "karma": "^3.1.1",
    "karma-chrome-launcher": "^2.2.0",
    "karma-coverage": "^1.1.2",
    "karma-firefox-launcher": "^1.1.0",
    "karma-mocha": "^1.3.0",
    "karma-spec-reporter": "0.0.32",
    "karma-webpack": "^3.0.5",
    "lodash": "^4.17.11",
    "mocha": "^5.2.0",
    "opn-cli": "^3.1.0",
    "puppeteer": "^1.9.0",
    "shx": "^0.3.2",
    "uglify-js": "^3.4.9",
    "uglifyjs-webpack-plugin": "^2.0.1",
    "webpack": "^4.23.1",
    "webpack-cli": "^3.1.2",
    "webpack-dev-server": "^3.1.10"
  },
  "dependencies": {
    "dicom-parser": "^1.8.1"
  }
}
`;

const wadoPath = "node_modules/cornerstone-wado-image-loader/package.json";

fs.writeFileSync(wadoPath, cornerstoneWADOImageLoaderPackageJson, "utf-8");
