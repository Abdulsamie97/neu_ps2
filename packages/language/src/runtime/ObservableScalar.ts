export const OBSERVABLE_SCALAR_RUNTIME = String.raw`var ObservableScalar = function (val) {
  this.value = null;
  if (val instanceof ObservableScalar) {
    this.value = val.get();
  } else if (
    typeof val === 'number' || val instanceof Number ||
    typeof val === 'string' || val instanceof String ||
    typeof val === 'boolean' || val instanceof Boolean
  ) {
    this.value = val;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};

ObservableScalar.prototype.set = function (val) {
  if (val instanceof ObservableScalar) {
    this.value = val.get();
  } else if (
    typeof val === 'number' || val instanceof Number ||
    typeof val === 'string' || val instanceof String ||
    typeof val === 'boolean' || val instanceof Boolean
  ) {
    this.value = val;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Setter: Incompatible type " + JSON.stringify(val));
  } else {
    this.value = null;
  }
};

ObservableScalar.prototype.get = function () {
  return this.value;
};`;
