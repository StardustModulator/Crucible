# ⚗️ Crucible

**A visual mathematics engine for robotics and machine learning.**
Every idea — from a rotation matrix to a diffusion policy — is a picture you can
grab, drag, and watch move. No paragraphs. No narration. If a five-year-old can't
get the gist by *looking and poking*, the scene isn't finished.

```
npm run serve        # → http://localhost:5173   (zero dependencies, no build step)
```

## What's inside

**86 interactive scenes** in five islands, wired into one web of ideas:

| Island | | What lives there |
|---|---|---|
| 🧮 **Math Core** | 23 | arrows, matrices, eigenvectors, SVD, least squares, rotations, quaternions, rigid motions, twists & the exponential map, slopes, chain rule, linearization, flows/ODEs, energy, Lyapunov stability, poles, Gaussians, Bayes, sampling, optimization, convolution, Bellman, information & KL |
| 👁️ **Sense & Plan** | 15 | pinhole cameras, hand–eye calibration (AX = XB), point registration, ICP, RANSAC, Kalman / EKF / SLAM, particle filters, occupancy maps, potential fields, configuration space, A*, RRT & PRM, virtual fixtures |
| 🦾 **Move & Control** | 17 | Euler angles & gimbal lock, forward kinematics, DH parameters, product of exponentials, Jacobians, manipulability, inverse kinematics, statics (τ = Jᵀ F), trajectories, Lagrangian arm dynamics, Newton–Euler, motors & gearing, PID, PD + gravity, computed torque, impedance, LQR |
| 🎓 **Robot Learning** | 14 | value iteration, Q-learning, bandits, policy gradient, behavior cloning & DAgger, action chunking, movement primitives, Gaussian processes, Gaussian mixtures, diffusion policy, flow matching, world models + MPC, action tokens, sim-to-real |
| 🧠 **Deep Learning** | 18 | neurons, softmax & cross-entropy, gradient descent, activations, MLPs, backprop, CNNs, overfitting, normalization, vanishing gradients & residuals, RNN/LSTM, attention, autoencoders, VAEs, GANs, diffusion, adversarial examples, LoRA |

### How the pictures talk

* **One color = one meaning, everywhere.** Orange is always a joint, pink is always the
  hand, gold is always the goal, teal is data, blue is the model's belief, purple is
  uncertainty, coral is error. Red/green/blue are x/y/z. (🎨 in the app shows the key.)
* **Story beats.** Each scene is 3–5 numbered chapters, from a toy (*"two blobs
  merge into a sharper blob"*) to the deep idea (*"the Kalman gain is a seesaw between
  model and sensor"*).
* **The grown-up layer is optional.** `∑` reveals the real equation — colored token by
  token to match the thing it describes in the picture.
* **It's all real math.** Every picture is computed live by the engine in `src/core`
  (SVD, Riccati iterations, RK4, backprop, EM…), which has its own test suite.

### The correlation engine

The point of Crucible is that these subjects are **one** subject. Every concept
declares the math it is built from (`src/graph/concepts.js`), and the app lets you
see that web three ways:

* **🌌 Constellation map** — hover any concept and its whole family lights up: all the
  math underneath it, and everything it feeds into.
* **🔗 Bridge** — pick any two ideas and get the shortest chain of math between them:
  *Jacobian → Slopes → Backprop*, *Kalman Filter → Bell Curves → Diffusion Policy*,
  *LQR → Bellman → Q-Learning*, *SVD → LoRA*. Shareable as `#/bridge/<a>/<b>`.
* **▦ Grid** — every math idea × every algorithm, solid for direct use, faint for
  "somewhere underneath".

## The concept web
**Math Core:** ➡️ Arrows · 🔲 Matrix · 🧭 Eigenvectors · 🥚 SVD · 📏 Least Squares · 🔄 Rotations · 🌐 Quaternions · 📦 Rigid Moves · 🔩 Twists & exp · 🛝 Slopes · ⚙️ Chain Rule · 🔍 Zoom = Flat · 🌊 Flows · 🎢 Energy · 🥣 Stability Bowl · 📍 Poles · 🔔 Bell Curves · 🔎 Bayes · 🎲 Sampling · ⛰️ Optimization · 🧽 Convolution · 🪜 Bellman · 😮 Surprise & KL

### 👁️ Sense & Plan

| Concept | Built from |
|---|---|
| 📷 Pinhole Camera `camera` | 📦 Rigid Moves · 🔲 Matrix · 📏 Least Squares |
| 🤝 Hand–Eye `hand-eye` | 📦 Rigid Moves · 🔄 Rotations · 🔩 Twists & exp · 📏 Least Squares · 🌐 Quaternions |
| 🧩 Point Matching `registration` | 🥚 SVD · 🔄 Rotations · 📏 Least Squares |
| 🧷 ICP `icp` | 🥚 SVD · 📏 Least Squares · 📦 Rigid Moves |
| 🗳️ RANSAC `ransac` | 🎲 Sampling · 📏 Least Squares |
| 🛰️ Kalman Filter `kalman` | 🔔 Bell Curves · 🔎 Bayes · 🔲 Matrix · 📏 Least Squares |
| 🗺️ EKF & SLAM `ekf` | 🔔 Bell Curves · 🔎 Bayes · 🔍 Zoom = Flat |
| ✨ Particle Filter `particle-filter` | 🎲 Sampling · 🔎 Bayes |
| 🧱 Occupancy Map `occupancy-grid` | 🔎 Bayes · 😮 Surprise & KL |
| 🧲 Potential Field `potential-field` | 🛝 Slopes · ⛰️ Optimization · ➡️ Arrows |
| 🌀 Config Space `cspace` | ➡️ Arrows · 📦 Rigid Moves |
| ⭐ A* Search `graph-search` | 🪜 Bellman · ⛰️ Optimization |
| 🌳 RRT & PRM `rrt` | 🎲 Sampling · ➡️ Arrows |
| 🚧 Virtual Fixtures `virtual-fixtures` | ⛰️ Optimization · 📏 Least Squares · 🛝 Slopes |

### 🦾 Move & Control

| Concept | Built from |
|---|---|
| 🎡 Euler & Gimbal Lock `euler-angles` | 🔄 Rotations |
| 🦾 Forward Kinematics `forward-kinematics` | 📦 Rigid Moves · 🔄 Rotations |
| 📐 DH Parameters `dh` | 📦 Rigid Moves · 🔲 Matrix |
| 🔗 Product of Exps `poe` | 🔩 Twists & exp · 📦 Rigid Moves |
| 🕹️ Jacobian `jacobian` | 🛝 Slopes · 🔲 Matrix · 🔍 Zoom = Flat · ⚙️ Chain Rule |
| 🏈 Manipulability `manipulability` | 🥚 SVD · 🧭 Eigenvectors |
| 🎯 Inverse Kinematics `ik` | 📏 Least Squares · 🥚 SVD · ⛰️ Optimization |
| 🏋️ Forces & Jᵀ `statics` | 🔲 Matrix · ➡️ Arrows |
| 🛤️ Trajectories `trajectory` | 🛝 Slopes · 🌊 Flows |
| 🤖 Arm Dynamics `lagrange-dynamics` | 🎢 Energy · 🛝 Slopes · 🔲 Matrix |
| 🪝 Newton–Euler `newton-euler` | ➡️ Arrows · 🛝 Slopes · 📦 Rigid Moves |
| 🔧 Motors & Gears `gearing` | 🎢 Energy · ⚙️ Chain Rule |
| 🎚️ PID `pid` | 🛝 Slopes · 🌊 Flows · 📍 Poles |
| 🪀 PD + Gravity `pd-gravity` | 🥣 Stability Bowl · 🎢 Energy |
| 🧮 Computed Torque `computed-torque` | 🤖 Arm Dynamics · 📍 Poles · 🔍 Zoom = Flat |
| 🫧 Impedance `impedance` | 🎢 Energy · 🥣 Stability Bowl |
| 🤸 LQR `lqr` | 🔍 Zoom = Flat · ⛰️ Optimization · 📍 Poles · 🪜 Bellman |

### 🎓 Robot Learning

| Concept | Built from |
|---|---|
| 💧 Value Iteration `value-iteration` | 🪜 Bellman |
| 🐭 Q-Learning `q-learning` | 🪜 Bellman · 🎲 Sampling |
| 🎰 Explore vs Exploit `bandits` | 🎲 Sampling · 🔔 Bell Curves |
| 🏹 Policy Gradient `policy-gradient` | 🛝 Slopes · 🎲 Sampling · 🔔 Bell Curves |
| 🐒 Behavior Cloning `behavior-cloning` | 📏 Least Squares · 😮 Surprise & KL |
| 🍫 Action Chunks `action-chunking` | 🔔 Bell Curves · 👀 Attention |
| 🎻 Movement Primitives `dmp` | 🌊 Flows · 📏 Least Squares · 🔔 Bell Curves |
| 🌈 Gaussian Process `gp-regression` | 🔔 Bell Curves · 🔎 Bayes · 🔲 Matrix |
| 🫐 Gaussian Mixtures `gmm` | 🔔 Bell Curves · 🔎 Bayes · ⛰️ Optimization |
| 🌪️ Diffusion Policy `diffusion-policy` | 🔔 Bell Curves · 🛝 Slopes · 🌊 Flows |
| 🧵 Flow Matching `flow-matching` | 🌊 Flows · 📏 Least Squares |
| 🔮 World Model + MPC `world-model` | ⛰️ Optimization · 🎲 Sampling · 🌊 Flows |
| 🔤 Action Tokens `action-tokens` | 🧽 Convolution · 😮 Surprise & KL |
| 🎭 Sim → Real `sim2real` | 🎲 Sampling · 🔔 Bell Curves |

### 🧠 Deep Learning

| Concept | Built from |
|---|---|
| 🔘 Neuron `perceptron` | ➡️ Arrows · 🔲 Matrix |
| 🥧 Softmax & CE `softmax` | 😮 Surprise & KL · 🔔 Bell Curves |
| ⛷️ Gradient Descent `gradient-descent` | 🛝 Slopes · ⛰️ Optimization |
| 📈 Activations `activations` | 🛝 Slopes |
| 🕸️ Neural Network `mlp` | 🔲 Matrix · ⚙️ Chain Rule |
| 🔙 Backprop `backprop` | ⚙️ Chain Rule · 🛝 Slopes |
| 🖼️ CNN `cnn` | 🧽 Convolution · 🔲 Matrix |
| 🧥 Overfitting `overfitting` | ⛰️ Optimization · 🔔 Bell Curves |
| ⚖️ Normalization `normalization` | 🔔 Bell Curves |
| 🏗️ Deep & Residual `vanishing-gradients` | ⚙️ Chain Rule · 🧭 Eigenvectors |
| 🔁 RNN & LSTM `rnn` | ⚙️ Chain Rule · 🔲 Matrix |
| 👀 Attention `attention` | 🔲 Matrix · ➡️ Arrows · 😮 Surprise & KL |
| 🗜️ Autoencoder `autoencoder` | 🥚 SVD · 📏 Least Squares |
| ☁️ VAE `vae` | 🔔 Bell Curves · 😮 Surprise & KL · 🎲 Sampling |
| 🎨 GAN `gan` | ⛰️ Optimization · 😮 Surprise & KL |
| 🌫️ Diffusion `diffusion` | 🔔 Bell Curves · 🌊 Flows · 🛝 Slopes |
| 🦹 Adversarial `adversarial` | 🛝 Slopes · ⛰️ Optimization |
| 🪶 LoRA `lora` | 🥚 SVD · 🔲 Matrix |

## Project layout

```
index.html              app entry (plain ES modules, no bundler)
styles/main.css         theme tokens (light + dark), icon-only controls
src/main.js             router: map · bridge · grid · scene pages
src/graph/concepts.js   the concept graph (islands, uses, next, bridge(), ancestry())
src/graph/map.js        constellation layout + drawing
src/core/               the math engine — no DOM, fully tested
  linalg.js             vectors, matrices, inverse, Cholesky, Jacobi eigen, one-sided Jacobi SVD, pinv, DLS
  lie.js                SO(3)/SE(3): hat/vee, Rodrigues exp/log, quaternions, slerp, twists, adjoint
  kinematics.js         planar FK/Jacobian/IK, manipulability, product of exponentials, space Jacobian, DH
  dynamics.js           RK4, pendulum, 2-link M(q)/C(q,q̇)/g(q), cart-pole + linearization
  control.js            PID, discretization, LQR (Riccati), cubic/quintic/trapezoid trajectories
  estimation.js         Kalman, EKF, resampling, Kabsch/ICP, RANSAC, line fits, log-odds, camera projection
  planning.js           A*, RRT, PRM, Dijkstra, potential fields, Minkowski sums
  learning.js           MLP + backprop, SGD/momentum/Adam, conv, attention, RL, GP, GMM/EM, PCA, DMP, diffusion, CEM
src/viz/                rendering toolkit
  stage.js              HiDPI canvas, world-coordinate pens, split panels, draggable handles, drawing primitives
  view3d.js             orbit camera + depth-sorted 3D primitives on a 2D canvas
  ui.js                 icon-only sliders, buttons, toggles, story beats, readouts
  palette.js            the color language + colormaps
src/scenes/<id>.js      one file per concept
tests/                  node:test suites for the math engine and the graph
scripts/serve.mjs       zero-dependency static server
scripts/smoke.mjs       opens every scene in headless Chromium, pokes it, fails on any error
docs/SCENE_GUIDE.md     how to write a scene
```

## Develop

```bash
npm test                      # math engine + concept graph tests
npm run serve                 # local server on :5173
npm run smoke                 # every scene in a real browser (needs Playwright + Chromium)
node scripts/smoke.mjs svd ik --shots ./shots --portrait   # specific scenes, phone layout, screenshots
```

Keyboard in a scene: `space` pause · `r` restart · `← →` neighbour scenes · `Esc` back to the map.

Adding a concept = one entry in `src/graph/concepts.js` + one file in `src/scenes/`.
Read [docs/SCENE_GUIDE.md](docs/SCENE_GUIDE.md) first — it holds the visual rules.

## License

MIT
