// Regenerate public/models/manifest.json and public/models/LICENSES.md from the
// built GLBs plus the attribution table below. Run after scripts/build-models.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const MODELS_DIR = 'public/models';
const NIH = (id) => `https://3d.nih.gov/entries/3DPX-${id}`;
const HRA_AUTHOR = 'HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")';
const CC_BY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const VH_F = 'Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002).';

const ENTRIES = [
  { id: 'body', file: 'body.glb', kind: 'body', system: undefined, title: 'SOMA-X "Anny" base body',
    source: 'https://github.com/NVlabs/SOMA-X (assets/Anny/base_body.obj)', sourceId: 'NVlabs/SOMA-X assets/Anny/base_body.obj',
    sourceFiles: ['elanor-twin/public/models/soma-x-base-body.obj (repo copy, sha256 7bf31cb…6504, byte-identical to upstream assets/Anny/base_body.obj)'],
    author: 'NVIDIA (SOMA-X); Anny topology by NAVER Corp.', license: 'Apache-2.0', licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    notes: 'Full adult, gender-neutral base body in a relaxed A-pose (arms slightly away from the torso, palms inward, feet apart), untextured, no UVs. Converted from OBJ (13,710 quads fan-triangulated to 27,420 triangles), welded, smooth normals computed, a plain skin-toned opaque material added. Units are metres, Y-up, 1.626 m tall; the origin is at hip height and the mesh is offset forward on z (z -0.029..0.391), so its z-centre (~0.18) does not coincide with the HRA organ frame (organs sit around z -0.15..0.05 with feet at y -0.79): position organs relative to the body explicitly rather than assuming a shared origin. The SOMA-X README notes optional third-party models keep their own terms; the Anny model is itself Apache-2.0 (code, NAVER Corp.) with MakeHuman/MPFB2-derived mesh assets under CC0 1.0.' },
  { id: 'heart', file: 'heart.glb', kind: 'organ', system: 'heart', title: 'Heart, Female', sourceId: '3DPX-020966', sourceFiles: ['VH_F_Heart.glb'],
    notes: `Whole heart with chambers, septum, valves and papillary muscles as 14 named sub-meshes (VH_F_*). ${VH_F} Decimated 85,914 -> ~60,000 triangles; smooth normals recomputed.` },
  { id: 'lungs', file: 'lungs.glb', kind: 'organ', system: 'lungs', title: 'Lung, Female', sourceId: '3DPX-020974', sourceFiles: ['3d-vh-f-lung.glb'],
    notes: `Both lungs with lobes / bronchopulmonary segments and intrapulmonary bronchi (trachea and main bronchi are not included in this HRA object). ${VH_F} 56 sub-meshes were joined by material (3 materials, 15 meshes remain), decimated 297,097 -> ~60,000 triangles; smooth normals recomputed.` },
  { id: 'kidneys', file: 'kidneys.glb', kind: 'organ', system: 'kidneys', title: 'Kidney, Female, Left + Kidney, Female, Right', sourceId: '3DPX-020967 + 3DPX-020968', sourceFiles: ['VH_F_Kidney_L.glb', 'VH_F_Kidney_R.glb'],
    notes: `Pair of kidneys merged from the two HRA entries (left 3DPX-020967, right 3DPX-020968) into one scene; each keeps its capsule, cortex/medulla and renal pyramids as named sub-meshes (VH_F_*_L / _R). ${VH_F} Decimated 147,071 -> ~60,000 triangles; smooth normals recomputed.` },
  { id: 'liver', file: 'liver.glb', kind: 'organ', system: 'liver', title: 'Liver, Female', sourceId: '3DPX-020973', sourceFiles: ['VH_F_Liver.glb'],
    notes: `Liver segments, lobes, ligaments and impressions as 26 named sub-meshes. ${VH_F} Decimated 93,303 -> ~60,000 triangles; smooth normals recomputed. Base colour is very dark (0.07,0.02,0.01) - consider overriding the material.` },
  { id: 'brain', file: 'brain.glb', kind: 'organ', system: 'mind', title: 'Brain, Female', sourceId: '3DPX-020959', sourceFiles: ['3d-vh-f-allen-brain.glb'],
    notes: `Whole brain derived by HRA from the Allen Human Brain Reference Atlas (Ding et al. 2016), mirrored and scaled to the Visible Human Female; the entry states the model was re-licensed CC BY 4.0 in v1.3. 283 anatomical sub-meshes were joined by material (2 materials, 3 meshes remain, sub-structure names are lost) and decimated 656,268 -> ~60,000 triangles; smooth normals recomputed.` },
  { id: 'gut', file: 'gut.glb', kind: 'organ', system: 'digestive', title: 'Large Intestine, Female + Small Intestine, Female', sourceId: '3DPX-020971 + 3DPX-020987', sourceFiles: ['SBU_F_Intestine_Large.glb', 'VH_F_Small_Intestine.glb'],
    notes: `Colon (caecum, appendix, ascending/transverse/descending/sigmoid colon, rectum) plus small intestine (duodenum, jejunum, ileum) merged into one scene, 19 named sub-meshes. HRA notes the female colon was modelled to follow the Visible Human Female path (not direct imaging data). No stomach is included (no suitably licensed clean stomach model found). Decimated 64,173 -> ~50,000 triangles; smooth normals recomputed.` },
  { id: 'joint', file: 'joint.glb', kind: 'organ', system: 'joints', title: 'Knee, Female, Left', sourceId: '3DPX-020969', sourceFiles: ['VH_F_Knee_L.glb'],
    notes: `Left knee joint: distal femur, patella, tibia, fibula, condyles, cartilage and meniscus as 20 named sub-meshes; the bbox is 0.77 m tall because the full femur/tibia shafts are included. ${VH_F} Not decimated (17,844 triangles); original normals kept.` },
  { id: 'pancreas', file: 'pancreas.glb', kind: 'organ', system: 'metabolic', title: 'Pancreas, Female', sourceId: '3DPX-020983', sourceFiles: ['3d-vh-f-pancreas.glb'],
    notes: `Pancreas head, neck, body, tail and uncinate process as 5 named sub-meshes. ${VH_F} Not decimated (12,894 triangles); original normals kept.` },
  { id: 'bladder', file: 'bladder.glb', kind: 'organ', system: 'kidneys', title: 'Urinary Bladder, Female', sourceId: '3DPX-020995', sourceFiles: ['VH_F_Urinary_Bladder.glb'],
    notes: `Urinary bladder dome, base, neck, trigone and ureteral orifices as 6 named sub-meshes. ${VH_F} Decimated 41,290 -> ~30,000 triangles; smooth normals recomputed.` },
];

const stats = JSON.parse(execFileSync('node', ['scripts/glb-stats.mjs', ...ENTRIES.map((e) => `${MODELS_DIR}/${e.file}`)], { encoding: 'utf8' }));
const byFile = Object.fromEntries(stats.map((s) => [s.file.split('/').pop(), s]));

const manifest = ENTRIES.map((e) => {
  const s = byFile[e.file];
  const source = e.sourceId.split(' + ').map((id) => NIH(id.replace('3DPX-', ''))).join(' ; ');
  return {
    id: e.id,
    file: e.file,
    kind: e.kind,
    ...(e.system ? { system: e.system } : {}),
    title: e.title,
    source: e.source ?? source,
    sourceId: e.sourceId,
    sourceFiles: e.sourceFiles,
    author: e.author ?? HRA_AUTHOR,
    license: e.license ?? CC_BY.license,
    licenseUrl: e.licenseUrl ?? CC_BY.licenseUrl,
    triangles: s.triangles,
    vertices: s.vertices,
    bytes: s.bytes,
    bbox: { x: s.bboxSize[0], y: s.bboxSize[1], z: s.bboxSize[2] },
    bboxMin: s.bboxMin,
    bboxMax: s.bboxMax,
    center: s.center,
    units: 'm',
    up: 'Y',
    meshes: s.meshes,
    materials: s.materials,
    animations: s.animations,
    skins: s.skins,
    notes: e.notes,
  };
});

writeFileSync(`${MODELS_DIR}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const lines = [];
lines.push('# 3D model attributions and licences');
lines.push('');
lines.push('Every file in this directory is a derivative of an openly licensed model.');
lines.push('');
lines.push('## body.glb - SOMA-X "Anny" base body (Apache-2.0)');
lines.push('');
lines.push('body.glb is converted from `assets/Anny/base_body.obj` in NVIDIA\'s SOMA-X repository, https://github.com/NVlabs/SOMA-X,');
lines.push('which is licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0; LICENSE file in the');
lines.push('repository). The copy used is the one committed in this repository at elanor-twin/public/models/soma-x-base-body.obj and is');
lines.push('byte-identical to the upstream Git-LFS object (sha256 7bf31cbc0897670de51b7cd6b1a3da55a35fe56ef1d7b2e6aae2f95a11196504, 1,182,571 bytes; verified 2026-09-12). The "Anny" topology originates from NAVER Corp.\'s Anny project');
lines.push('(https://github.com/naver/anny, code Apache-2.0, Copyright (c) 2025 NAVER Corp.; its MakeHuman/MPFB2-derived mesh assets');
lines.push('are CC0 1.0). Apache-2.0 notice requirement (section 4): when redistributing, keep this attribution, include a copy of the');
lines.push('Apache License 2.0 (e.g. in the app\'s open-source notices), state that the file was modified (OBJ quads triangulated,');
lines.push('vertices welded, smooth normals computed, a plain material added, converted to GLB), and reproduce any NOTICE file the');
lines.push('upstream repository ships (none was present at the time of retrieval). Copyright NVIDIA Corporation; no endorsement implied.');
lines.push('');
lines.push('## Organ files - Human Reference Atlas via NIH 3D (CC BY 4.0)');
lines.push('');
lines.push('All organ files (everything except body.glb) come from the');
lines.push('**Human Reference Atlas (HRA) 3D Reference Object Library** as published on **NIH 3D** (https://3d.nih.gov),');
lines.push('NIH 3D collection "Human Reference Atlas 3D Reference Object Library" (https://3d.nih.gov/collections/hra),');
lines.push('sub-collection "Visible Human Female". Each entry page states the licence **CC-BY** with a link to');
lines.push('https://creativecommons.org/licenses/by/4.0/ (Creative Commons Attribution 4.0 International).');
lines.push('');
lines.push('Attribution (please reproduce in the app\'s credits): "3D reference organs by the Human Reference Atlas (HRA),');
lines.push('https://humanatlas.io/3d-reference-library, published on NIH 3D (https://3d.nih.gov), licensed CC BY 4.0.');
lines.push('Derived from the NLM Visible Human Project (Spitzer & Whitlock 2002) and, for the brain, the Allen Human Brain');
lines.push('Reference Atlas (Ding et al. 2016). Meshes were decimated, merged and re-normalled for this app."');
lines.push('');
lines.push('Changes made to every organ file (required to be stated under CC BY): converted/merged with gltf-transform, animations and');
lines.push('skins stripped (none were present), duplicate data removed, triangle counts reduced with meshoptimizer where noted,');
lines.push('smooth vertex normals recomputed where noted, attribution embedded in the glTF `asset.copyright` field. Geometry');
lines.push('units (metres, Y-up) and the shared body-centred coordinate frame were left unchanged.');
lines.push('');
lines.push('Retrieved from NIH 3D on 2026-09-12 via the entry pages listed below (files served by https://3d.nih.gov/api/files/<id>).');
lines.push('');
for (const m of manifest) {
  if (m.id === 'body') continue; // covered by the Apache-2.0 section above
  const e = ENTRIES.find((x) => x.id === m.id);
  lines.push(`## ${m.file} - ${m.title}`);
  lines.push('');
  lines.push(`- Source: ${m.source}`);
  lines.push(`- Source file(s): ${e.sourceFiles.join(', ')}`);
  lines.push(`- Author: ${m.author}`);
  lines.push(`- Licence: ${m.license} (${m.licenseUrl})`);
  lines.push(`- Result: ${m.triangles.toLocaleString('en-US')} triangles, ${(m.bytes / 1e6).toFixed(2)} MB, bbox ${m.bbox.x} x ${m.bbox.y} x ${m.bbox.z} m`);
  lines.push(`- Notes: ${m.notes}`);
  lines.push('');
}
lines.push('## Sources checked but not used');
lines.push('');
lines.push('- NIH 3D 3DPX-020986 "Skin, Female" (HRA, CC BY 4.0): a full female body surface in the same metre/Y-up frame as the organs (266,696 triangles, alpha-blended material). Fully processed and verified (60k triangles, 1.08 MB) but not shipped because the project already had the SOMA-X body; rebuild it with `node scripts/build-models.mjs <src> public/models body-hra` if a body that shares the organ coordinate frame is wanted.');
lines.push('- three.js example models (Xbot.glb, Soldier.glb, Michelle.glb): the example pages credit them to mixamo.com (Adobe Mixamo terms), so they are not covered by the repository MIT licence and were rejected.');
lines.push('- poly.pizza "Heart" (https://poly.pizza/m/8RA5hHU5gHK), "Brain" (https://poly.pizza/m/5mPRPZkI3qt), "Kidneys" (https://poly.pizza/m/fF04IGr3X6q) by Poly by Google, CC-BY 3.0, and "Man" by Quaternius (https://poly.pizza/m/HMnuH5geEG, CC0): valid licences and direct downloads (https://static.poly.pizza/<uuid>.glb) but very low-poly/stylised; kept as documented fallbacks only, not shipped.');
lines.push('- Wikimedia Commons "File:3D model of a human heart.stl" (CC BY 4.0, 22,562 triangles): valid, not shipped because the HRA heart is anatomically consistent with the other organs.');
lines.push('- NIH 3D 3DPX-000388 "Knee Model" (CC0) and 3DPX-002636 "17 yo Female, Normal Heart" (CC0): valid public-domain CT-derived meshes (191k / 631k triangles, mm units) but noisier than the HRA versions.');
lines.push('- NIH 3D entries by user "Johnson J" (kidney 3DPX-023373, stomach 3DPX-021124): licence shown as CC0 / CC BY, but the descriptions claim a third-party copyright and link to a commercial site, so provenance was judged unclear and they were not used.');
lines.push('- BodyParts3D (CC BY-SA 2.1 JP): only bulk archives (62-136 MB) are offered, no per-organ download; skipped. Open Anatomy / SPL atlases: distributed as 3D Slicer scenes, skipped. Khronos CesiumMan (CC BY 4.0): a textured, logo-branded low-poly figure, not suitable.');
lines.push('');
writeFileSync(`${MODELS_DIR}/LICENSES.md`, lines.join('\n'));
console.log(`wrote ${MODELS_DIR}/manifest.json (${manifest.length} entries) and ${MODELS_DIR}/LICENSES.md`);
