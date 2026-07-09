import { OBSERVABLE_ARRAY_RUNTIME } from './ObservableArray.js';
import { OBSERVABLE_SCALAR_RUNTIME } from './ObservableScalar.js';
import { OBSERVABLE_STRUCT_RUNTIME } from './ObservableStruct.js';
import { PSEUDO2_RUNTIME_HELPERS } from './RuntimeHelpers.js';

export const PSEUDO2_RUNTIME_PRELUDE = [
  OBSERVABLE_SCALAR_RUNTIME,
  OBSERVABLE_ARRAY_RUNTIME,
  OBSERVABLE_STRUCT_RUNTIME,
  PSEUDO2_RUNTIME_HELPERS
].join('\n\n');
