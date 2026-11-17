// World registry: name -> lazy loader. Worlds are pure data.
export const WORLDS = {
  'earth-forest': () => import('./earth-forest.js'),
};

export async function loadWorld(name) {
  const loader = WORLDS[name] || WORLDS['earth-forest'];
  return (await loader()).default;
}
