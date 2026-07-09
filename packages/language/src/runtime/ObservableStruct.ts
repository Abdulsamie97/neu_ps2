export const OBSERVABLE_STRUCT_RUNTIME = String.raw`var ObservableStruct = function (val) {
  this.ref = new Object();
  if (val instanceof ObservableStruct) {
    this.ref = val.ref;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};

ObservableStruct.prototype.get = function () {
  return this;
};

ObservableStruct.prototype.getRef = function () {
  return this.ref;
};

ObservableStruct.prototype.attrVal = function (attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot access of attribute '" + attrName + "' on a null object");
  }
  return this.ref[attrName];
};

ObservableStruct.prototype.setAttr = function (val, attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot set attribute '" + attrName + "' on a null object");
  }
  if (val === null) {
    const newVal = new ObservableStruct(null);
    newVal.set(null);
    this.ref[attrName] = newVal;
  } else {
    this.ref[attrName] = val;
  }
};

ObservableStruct.prototype.setAttrIndex = function (val, index, attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot set attribute '" + attrName + "' on a null object");
  }
  this.ref[attrName].set(val, index);
};

ObservableStruct.prototype.attrValIndex = function (attrName, index) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot access of attribute '" + attrName + "' on a null object");
  }
  if (this.ref[attrName] instanceof ObservableArray) {
    return this.ref[attrName].get(index);
  }
  throw new Error("ObservableStruct.attrValIndex: Cannot find ObservableArray for attribute '" + attrName + "'");
};

ObservableStruct.prototype.set = function (val) {
  if (val === null) {
    this.ref = null;
    return;
  }
  this.ref = new Object();
  if (val instanceof ObservableStruct) {
    this.ref = val.ref;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};`;
