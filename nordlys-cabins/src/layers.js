import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const DEFAULT_LAYERS_DIR = fileURLToPath(new URL('../layers/', import.meta.url));
const FOLDER = /^(\d{2})-([a-z0-9][a-z0-9-]*)$/;

/**
 * Find every layer folder (layers/NN-slug/index.js), import it, check that it
 * follows the contract, and return them sorted by chapter, then folder name.
 * Nothing is enabled here; see selectLayers().
 */
export async function discoverLayers(dir = DEFAULT_LAYERS_DIR) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of (await readdir(dir)).sort()) {
    const m = FOLDER.exec(name);
    const folder = path.join(dir, name);
    if (!m || !(await stat(folder)).isDirectory()) continue;
    const entry = path.join(folder, 'index.js');
    if (!existsSync(entry)) throw new Error(`Layer folder ${name} has no index.js`);
    const mod = await import(pathToFileURL(entry).href);
    const layer = mod.default ?? mod;
    const problems = [];
    if (!Number.isInteger(layer.chapter)) problems.push('export "chapter" (an integer)');
    if (typeof layer.name !== 'string' || !layer.name) problems.push('export "name" (a string)');
    if (typeof layer.description !== 'string') problems.push('export "description" (a string)');
    if (typeof layer.register !== 'function') problems.push('export "register(app, ctx)" (a function)');
    if (problems.length) throw new Error(`Layer ${name} must ${problems.join(', ')}`);
    if (layer.chapter !== Number(m[1]))
      throw new Error(`Layer ${name} says chapter ${layer.chapter}, but its folder starts with ${m[1]}`);
    found.push({
      id: name,
      chapter: layer.chapter,
      name: layer.name,
      description: layer.description,
      enabled: layer.enabled ?? true,
      register: layer.register,
      dir: folder,
      publicDir: existsSync(path.join(folder, 'public')) ? path.join(folder, 'public') : null,
    });
  }
  return found.sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id));
}

/** Keep the layers with chapter <= upto whose `enabled` flag (or function) says yes. */
export function selectLayers(layers, config) {
  return layers.filter((l) => {
    if (l.chapter > config.upto) return false;
    return typeof l.enabled === 'function' ? Boolean(l.enabled(config)) : Boolean(l.enabled);
  });
}
