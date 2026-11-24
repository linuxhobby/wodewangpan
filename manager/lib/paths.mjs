import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CONFIG_DIR = path.join(ROOT, 'config');
export const MANAGER_PUBLIC = path.join(ROOT, 'manager', 'public');
