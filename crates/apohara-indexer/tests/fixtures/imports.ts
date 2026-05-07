// Named imports
import { a, b, c } from './module-a';
import { foo as bar, baz } from 'external-package';

// Default import
import React from 'react';
import MyClass from './my-class';

// Namespace import
import * as Utils from './utils';
import * as Lodash from 'lodash';

// Side-effect import
import 'polyfills';
import './styles.css';

// Re-exports
export { a, b } from './module-a';
export { foo as bar } from 'external-package';
export * from './re-export-all';

// Default export
export default function defaultExport() {}

// Named exports
export function namedExport() {}
export class NamedClass {}

// require() style
const fs = require('fs');
const path = require('path');
const dynamic = require('./dynamic');