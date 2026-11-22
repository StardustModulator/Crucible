// The concept graph: every algorithm is wired to the mathematics it is built from.
// `uses`  → math ideas this concept is made of (edges into the Math Core).
// `next`  → algorithms that build directly on this one (edges between islands).
// Names are deliberately tiny; the pictures do the explaining.

export const ISLANDS = {
  math:  { name: 'Math Core',      icon: '🧮', color: 'gold',   angle: null },
  sense: { name: 'Sense & Plan',   icon: '👁️', color: 'teal',   angle: -Math.PI * 0.75 },
  move:  { name: 'Move & Control', icon: '🦾', color: 'orange', angle: -Math.PI * 0.25 },
  learn: { name: 'Robot Learning', icon: '🎓', color: 'lime',   angle: Math.PI * 0.25 },
  deep:  { name: 'Deep Learning',  icon: '🧠', color: 'pink',   angle: Math.PI * 0.75 },
};

const N = (island, id, name, icon, uses = [], next = []) => ({ island, id, name, icon, uses, next });

export const CONCEPTS = [
  // ───────────── Math Core ─────────────
  N('math', 'vectors', 'Arrows', '➡️'),
  N('math', 'matrix', 'Matrix', '🔲', ['vectors']),
  N('math', 'eigen', 'Eigenvectors', '🧭', ['matrix']),
  N('math', 'svd', 'SVD', '🥚', ['matrix', 'eigen', 'rotation']),
  N('math', 'least-squares', 'Least Squares', '📏', ['matrix', 'svd', 'optimization']),
  N('math', 'rotation', 'Rotations', '🔄', ['matrix', 'vectors']),
  N('math', 'quaternion', 'Quaternions', '🌐', ['rotation']),
  N('math', 'rigid-transform', 'Rigid Moves', '📦', ['rotation', 'vectors']),
  N('math', 'screw-exp', 'Twists & exp', '🔩', ['rigid-transform', 'rotation', 'ode']),
  N('math', 'derivative', 'Slopes', '🛝', ['vectors']),
  N('math', 'chain-rule', 'Chain Rule', '⚙️', ['derivative']),
  N('math', 'linearize', 'Zoom = Flat', '🔍', ['derivative', 'matrix']),
  N('math', 'ode', 'Flows', '🌊', ['derivative', 'vectors']),
  N('math', 'energy', 'Energy', '🎢', ['derivative', 'ode']),
  N('math', 'lyapunov', 'Stability Bowl', '🥣', ['energy', 'derivative']),
  N('math', 'poles', 'Poles', '📍', ['eigen', 'ode']),
  N('math', 'gaussian', 'Bell Curves', '🔔', ['vectors', 'matrix']),
  N('math', 'bayes', 'Bayes', '🔎', ['gaussian']),
  N('math', 'sampling', 'Sampling', '🎲', ['gaussian']),
  N('math', 'optimization', 'Optimization', '⛰️', ['derivative']),
  N('math', 'convolution', 'Convolution', '🧽', ['vectors']),
  N('math', 'bellman', 'Bellman', '🪜', ['optimization']),
  N('math', 'information', 'Surprise & KL', '😮', ['gaussian']),

  // ───────────── Sense & Plan ─────────────
  N('sense', 'camera', 'Pinhole Camera', '📷', ['rigid-transform', 'matrix', 'least-squares'], ['hand-eye']),
  N('sense', 'hand-eye', 'Hand–Eye', '🤝', ['rigid-transform', 'rotation', 'screw-exp', 'least-squares', 'quaternion'], []),
  N('sense', 'registration', 'Point Matching', '🧩', ['svd', 'rotation', 'least-squares'], ['icp', 'hand-eye']),
  N('sense', 'icp', 'ICP', '🧷', ['svd', 'least-squares', 'rigid-transform'], []),
  N('sense', 'ransac', 'RANSAC', '🗳️', ['sampling', 'least-squares'], ['registration']),
  N('sense', 'kalman', 'Kalman Filter', '🛰️', ['gaussian', 'bayes', 'matrix', 'least-squares'], ['ekf']),
  N('sense', 'ekf', 'EKF & SLAM', '🗺️', ['gaussian', 'bayes', 'linearize'], []),
  N('sense', 'particle-filter', 'Particle Filter', '✨', ['sampling', 'bayes'], []),
  N('sense', 'occupancy-grid', 'Occupancy Map', '🧱', ['bayes', 'information'], []),
  N('sense', 'potential-field', 'Potential Field', '🧲', ['derivative', 'optimization', 'vectors'], []),
  N('sense', 'cspace', 'Config Space', '🌀', ['vectors', 'rigid-transform'], ['graph-search', 'rrt']),
  N('sense', 'graph-search', 'A* Search', '⭐', ['bellman', 'optimization'], []),
  N('sense', 'rrt', 'RRT & PRM', '🌳', ['sampling', 'vectors'], []),
  N('sense', 'virtual-fixtures', 'Virtual Fixtures', '🚧', ['optimization', 'least-squares', 'derivative'], []),

  // ───────────── Move & Control ─────────────
  N('move', 'euler-angles', 'Euler & Gimbal Lock', '🎡', ['rotation'], ['quaternion']),
  N('move', 'forward-kinematics', 'Forward Kinematics', '🦾', ['rigid-transform', 'rotation'], ['jacobian', 'cspace']),
  N('move', 'dh', 'DH Parameters', '📐', ['rigid-transform', 'matrix'], ['forward-kinematics']),
  N('move', 'poe', 'Product of Exps', '🔗', ['screw-exp', 'rigid-transform'], ['jacobian']),
  N('move', 'jacobian', 'Jacobian', '🕹️', ['derivative', 'matrix', 'linearize', 'chain-rule'], ['manipulability', 'ik', 'statics']),
  N('move', 'manipulability', 'Manipulability', '🏈', ['svd', 'eigen'], []),
  N('move', 'ik', 'Inverse Kinematics', '🎯', ['least-squares', 'svd', 'optimization'], ['virtual-fixtures']),
  N('move', 'statics', 'Forces & Jᵀ', '🏋️', ['matrix', 'vectors'], ['impedance', 'potential-field']),
  N('move', 'trajectory', 'Trajectories', '🛤️', ['derivative', 'ode'], ['computed-torque']),
  N('move', 'lagrange-dynamics', 'Arm Dynamics', '🤖', ['energy', 'derivative', 'matrix'], ['computed-torque', 'pd-gravity']),
  N('move', 'newton-euler', 'Newton–Euler', '🪝', ['vectors', 'derivative', 'rigid-transform'], []),
  N('move', 'gearing', 'Motors & Gears', '🔧', ['energy', 'chain-rule'], []),
  N('move', 'pid', 'PID', '🎚️', ['derivative', 'ode', 'poles'], ['pd-gravity']),
  N('move', 'pd-gravity', 'PD + Gravity', '🪀', ['lyapunov', 'energy'], ['computed-torque']),
  N('move', 'computed-torque', 'Computed Torque', '🧮', ['lagrange-dynamics', 'poles', 'linearize'], []),
  N('move', 'impedance', 'Impedance', '🫧', ['energy', 'lyapunov'], []),
  N('move', 'lqr', 'LQR', '🤸', ['linearize', 'optimization', 'poles', 'bellman'], ['world-model']),

  // ───────────── Robot Learning ─────────────
  N('learn', 'value-iteration', 'Value Iteration', '💧', ['bellman'], ['q-learning']),
  N('learn', 'q-learning', 'Q-Learning', '🐭', ['bellman', 'sampling'], []),
  N('learn', 'bandits', 'Explore vs Exploit', '🎰', ['sampling', 'gaussian'], ['q-learning']),
  N('learn', 'policy-gradient', 'Policy Gradient', '🏹', ['derivative', 'sampling', 'gaussian'], []),
  N('learn', 'behavior-cloning', 'Behavior Cloning', '🐒', ['least-squares', 'information'], ['action-chunking', 'diffusion-policy']),
  N('learn', 'action-chunking', 'Action Chunks', '🍫', ['gaussian', 'attention'], []),
  N('learn', 'dmp', 'Movement Primitives', '🎻', ['ode', 'least-squares', 'gaussian'], []),
  N('learn', 'gp-regression', 'Gaussian Process', '🌈', ['gaussian', 'bayes', 'matrix'], []),
  N('learn', 'gmm', 'Gaussian Mixtures', '🫐', ['gaussian', 'bayes', 'optimization'], []),
  N('learn', 'diffusion-policy', 'Diffusion Policy', '🌪️', ['gaussian', 'derivative', 'ode'], []),
  N('learn', 'flow-matching', 'Flow Matching', '🧵', ['ode', 'least-squares'], []),
  N('learn', 'world-model', 'World Model + MPC', '🔮', ['optimization', 'sampling', 'ode'], []),
  N('learn', 'action-tokens', 'Action Tokens', '🔤', ['convolution', 'information'], ['attention']),
  N('learn', 'sim2real', 'Sim → Real', '🎭', ['sampling', 'gaussian'], []),

  // ───────────── Deep Learning ─────────────
  N('deep', 'perceptron', 'Neuron', '🔘', ['vectors', 'matrix'], ['mlp']),
  N('deep', 'softmax', 'Softmax & CE', '🥧', ['information', 'gaussian'], []),
  N('deep', 'gradient-descent', 'Gradient Descent', '⛷️', ['derivative', 'optimization'], ['backprop']),
  N('deep', 'activations', 'Activations', '📈', ['derivative'], ['mlp']),
  N('deep', 'mlp', 'Neural Network', '🕸️', ['matrix', 'chain-rule'], ['backprop', 'behavior-cloning']),
  N('deep', 'backprop', 'Backprop', '🔙', ['chain-rule', 'derivative'], []),
  N('deep', 'cnn', 'CNN', '🖼️', ['convolution', 'matrix'], []),
  N('deep', 'overfitting', 'Overfitting', '🧥', ['optimization', 'gaussian'], []),
  N('deep', 'normalization', 'Normalization', '⚖️', ['gaussian'], []),
  N('deep', 'vanishing-gradients', 'Deep & Residual', '🏗️', ['chain-rule', 'eigen'], []),
  N('deep', 'rnn', 'RNN & LSTM', '🔁', ['chain-rule', 'matrix'], ['attention']),
  N('deep', 'attention', 'Attention', '👀', ['matrix', 'vectors', 'information'], ['action-chunking']),
  N('deep', 'autoencoder', 'Autoencoder', '🗜️', ['svd', 'least-squares'], ['vae']),
  N('deep', 'vae', 'VAE', '☁️', ['gaussian', 'information', 'sampling'], ['action-chunking']),
  N('deep', 'gan', 'GAN', '🎨', ['optimization', 'information'], []),
  N('deep', 'diffusion', 'Diffusion', '🌫️', ['gaussian', 'ode', 'derivative'], ['diffusion-policy']),
  N('deep', 'adversarial', 'Adversarial', '🦹', ['derivative', 'optimization'], []),
  N('deep', 'lora', 'LoRA', '🪶', ['svd', 'matrix'], []),
];

export const BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));

// Fix up references to ids that live outside the math island but are used as ingredients
// (e.g. action-chunking uses attention) — they are valid as long as the node exists.
for (const c of CONCEPTS) {
  for (const u of [...c.uses, ...c.next]) if (!BY_ID[u]) console.warn(`concept ${c.id} references unknown ${u}`);
}

// Everything that builds on a concept (reverse edges) — "where does this show up?"
export function dependents(id) {
  const out = new Set();
  for (const c of CONCEPTS) if (c.uses.includes(id)) out.add(c.id);
  for (const n of BY_ID[id]?.next ?? []) out.add(n);
  return [...out].map((i) => BY_ID[i]);
}
// Full ancestry (all math underneath, transitively).
export function ancestry(id, seen = new Set()) {
  for (const u of BY_ID[id]?.uses ?? []) if (!seen.has(u)) { seen.add(u); ancestry(u, seen); }
  return seen;
}
export const neighbors = (island) => CONCEPTS.filter((c) => c.island === island);

// Shortest chain of ideas linking any two concepts (undirected over uses/next edges).
// e.g. bridge('svd', 'lora') or bridge('jacobian', 'backprop') → [ids…]
export function bridge(a, b) {
  if (!BY_ID[a] || !BY_ID[b]) return null;
  const adj = new Map(CONCEPTS.map((c) => [c.id, new Set()]));
  for (const c of CONCEPTS) for (const u of [...c.uses, ...c.next]) { adj.get(c.id).add(u); adj.get(u)?.add(c.id); }
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const x = queue.shift();
    if (x === b) break;
    // Prefer walking through the Math Core: visit math neighbours first.
    const nb = [...adj.get(x)].sort((p, q) => (BY_ID[p].island === 'math' ? 0 : 1) - (BY_ID[q].island === 'math' ? 0 : 1));
    for (const y of nb) if (!prev.has(y)) { prev.set(y, x); queue.push(y); }
  }
  if (!prev.has(b)) return null;
  const path = [];
  for (let x = b; x !== null; x = prev.get(x)) path.push(x);
  return path.reverse();
}
