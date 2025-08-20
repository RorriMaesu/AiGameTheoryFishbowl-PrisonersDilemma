import React, { useRef, useEffect, useState, Suspense, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import * as THREE from 'three';

// Toggle for verbose logs without editing many lines
const DEBUG = false;

// Professional Cinematic Camera Controller
function CinematicCamera({ agentPositions, ring, boundsByIndex, agentRefs, onFocusChange }) {
  const { camera, scene } = useThree();
  const cameraTargetRef = useRef(new THREE.Vector3());
  const cameraPositionRef = useRef(new THREE.Vector3());
  // Scratch vectors to avoid per-frame allocations
  const tmpTargetRef = useRef(new THREE.Vector3());
  const tmpCamPosRef = useRef(new THREE.Vector3());
  const tmpVecRef = useRef(new THREE.Vector3());
  const currentCharacterIndex = useRef(0);
  const shotTimer = useRef(0);
  const shotDuration = useRef(7.5); // broadcast pacing per focus
  const transitionDuration = 1.2; // quicker cut-like easing
  // Occlusion fading state
  const rayRef = useRef(new THREE.Raycaster());
  // Limit occlusion raycasts to a dedicated layer (2)
  useEffect(() => {
    if (rayRef.current && rayRef.current.layers) {
      rayRef.current.layers.set(2);
    }
  }, []);
  // Maintain a compact list of raycast candidates (only occlusion-relevant meshes)
  const occluderListRef = useRef([]);
  const refreshOccluders = useCallback(() => {
    const out = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.layers && obj.layers.test(rayRef.current.layers)) {
        out.push(obj);
      }
    });
    occluderListRef.current = out;
  }, [scene]);
  useEffect(() => {
    // Initial build and slow refresh
    refreshOccluders();
    const id = setInterval(refreshOccluders, 2000);
    return () => clearInterval(id);
  }, [refreshOccluders]);
  const occlusionTickRef = useRef(0);
  const fadedRef = useRef(new Set());
  const originalRef = useRef(new WeakMap());
  
  // Compute the minimum distance needed to frame a box with given FOV/aspect
  function getFitDistance(bounds, fovDeg, aspect) {
    const margin = 1.15; // add a little breathing room
    const vFov = THREE.MathUtils.degToRad(fovDeg);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const requiredForHeight = (bounds.height * margin) / (2 * Math.tan(vFov / 2));
    const requiredForWidth = (bounds.width * margin) / (2 * Math.tan(hFov / 2));
    return Math.max(requiredForHeight, requiredForWidth);
  }
  
  // Broadcast rigs
  const rigTypes = ['hard-cam', 'ringside-dolly', 'corner-jib', 'overhead'];
  const rigIndexRef = useRef(0);
  const railAngleRef = useRef(0); // smoothed azimuth along rail

  // Helpers
  const rotate2D = (x, z, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [x * c - z * s, z * c + x * s];
  };
  // Use +Z as zero-angle forward. For an angle 'a' from Math.atan2(x,z), the unit dir is (sin(a), cos(a)).
  const dirFromAngle = (ang) => [Math.sin(ang), Math.cos(ang)];
  
  useFrame((state, delta) => {
    occlusionTickRef.current += delta;
    if (!agentPositions.length) {
      return;
    }
    
    shotTimer.current += delta;
    // Switch focus and occasionally rig
    if (shotTimer.current >= shotDuration.current) {
      currentCharacterIndex.current = (currentCharacterIndex.current + 1) % agentPositions.length;
      shotTimer.current = 0;
      shotDuration.current = 6 + Math.random() * 3.5; // 6–9.5s
      if (Math.random() < 0.55) {
        rigIndexRef.current = (rigIndexRef.current + 1) % rigTypes.length;
      }
      if (onFocusChange) { onFocusChange(currentCharacterIndex.current); }
    }
    
    const currentCharacterPos = agentPositions[currentCharacterIndex.current];
    const currentCharacter = ring[currentCharacterIndex.current];
  const bounds = (boundsByIndex && boundsByIndex[currentCharacterIndex.current]) || { height: 1.6, width: 0.6, centerY: 0.8 };
  const progress = shotTimer.current / Math.max(1e-3, shotDuration.current);
  const rigType = rigTypes[rigIndexRef.current % rigTypes.length];
    
    // Calculate target position (where camera looks) - aim at character's center for full-body framing
    // Aim at upper chest/neck area to keep headroom similar to broadcast framing
    const headroom = Math.max(0.75, Math.min(1.1, (bounds.height ?? 1.6) * 0.52));
    const targetPos = tmpTargetRef.current.set(
      currentCharacterPos[0],
      currentCharacterPos[1] + headroom,
      currentCharacterPos[2]
    );
    
    // Compute a rail-based, ringside camera like a real broadcast
  let cameraPos = tmpCamPosRef.current.set(0, 0, 0);
    const avgH = (() => {
      const hs = (boundsByIndex || []).map(b => b && b.height).filter(Boolean);
      if (!hs.length) { return 1.6; }
      return hs.reduce((a, b) => a + b, 0) / hs.length;
    })();

    // Estimate ring radius from current layout
    const rLayout = agentPositions.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[2])), 0);
    const ringRadius = Math.max(1.8, rLayout * 1.03);
    const railClear = Math.max(0.6, avgH * 0.7); // clearance beyond ropes
    const railRadius = ringRadius + railClear;

  // Outside direction from center to target (ensures front/side, never back)
    const dirX0 = currentCharacterPos[0];
    const dirZ0 = currentCharacterPos[2];
    let len = Math.hypot(dirX0, dirZ0);
    let outX = len > 1e-3 ? dirX0 / len : Math.cos(railAngleRef.current);
    let outZ = len > 1e-3 ? dirZ0 / len : Math.sin(railAngleRef.current);

  // Side angle offset stays within front hemisphere relative to agent forward
  const sideSwing = 0.45 + 0.15 * Math.sin(state.clock.elapsedTime * 0.35); // radians ≈ 26°–36°
  let sideSign = 1;
    // Rig-specific behavior
    switch (rigType) {
      case 'hard-cam': {
        // Fixed broadcast side; align with world -Z side
        const hardDir = new THREE.Vector2(0, -1);
        // Ensure we're on outside side relative to fighter: flip if needed
        const d = outX * hardDir.x + outZ * hardDir.y;
        const base = d > 0 ? hardDir : hardDir.clone().multiplyScalar(-1);
        outX = base.x; outZ = base.y;
        sideSign = (currentCharacterIndex.current % 2 === 0) ? 1 : -1;
        break;
      }
      case 'ringside-dolly':
        // Use outside direction, add gentle around-the-rail motion
        railAngleRef.current = Math.atan2(outX, outZ);
        sideSign = Math.sin(state.clock.elapsedTime * 0.25 + currentCharacterIndex.current) > 0 ? 1 : -1;
        break;
      case 'corner-jib': {
        // Snap toward nearest corner direction
        const ang = Math.atan2(dirX0, dirZ0);
        const corner = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
        const [rx, rz] = dirFromAngle(corner);
        outX = rx; outZ = rz;
        break;
      }
      case 'overhead':
        // Keep outside but higher later
        railAngleRef.current = Math.atan2(outX, outZ);
        break;
    }

    // Retrieve the agent's actual forward using world direction to bias to their front
    let yaw = null; // keep for fallback
    let fwd2 = null; // 2D world-space forward (x,z)
    const agentRef = agentRefs?.current?.[currentCharacterIndex.current];
    if (agentRef) {
      if (agentRef.rotation) { yaw = agentRef.rotation.y; }
      if (agentRef.getWorldDirection) {
        const wd = new THREE.Vector3();
        agentRef.getWorldDirection(wd); // points along the object's -Z axis in world space (visual "front" for most FBX)
        const len2 = Math.hypot(wd.x, wd.z);
        if (len2 > 1e-3) { fwd2 = new THREE.Vector2(wd.x / len2, wd.z / len2); }
      }
    }
    // Base angle from real forward if available; otherwise from yaw (offset by PI to map -Z front to our +Z=0 convention), else from outward vector
    const baseAngle = fwd2
      ? Math.atan2(fwd2.x, fwd2.y)
      : (yaw != null ? (yaw + Math.PI) : Math.atan2(outX, outZ));
    // Keep camera within ±70° of the agent's forward to avoid back or pure side views
  const clampTo = 55 * Math.PI / 180; // keep camera more in front (≤ ~55° off forward)
    const desired = baseAngle + (sideSign * sideSwing);
    // Find an outside vector closest to desired without crossing behind target
    let finalAngle = desired;
    let diff = ((finalAngle - baseAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(diff) > clampTo) {
      finalAngle = baseAngle + Math.sign(diff) * clampTo;
    }
    // Safety: guarantee the camera lies in the front hemisphere (not back)
    {
      const fwd = fwd2 ?? new THREE.Vector2(...dirFromAngle((yaw ?? 0) + Math.PI));
      const test = new THREE.Vector2(...dirFromAngle(finalAngle));
      // Require a healthy front-facing dot; 0.25 ~ 75° off front max
  const minFrontDot = 0.5; // ~60° off forward max for the angle test
      if (fwd.dot(test) < minFrontDot) {
        const sign = Math.sign(diff || 1);
        // Pull angle back toward agent front but keep some side look
        const maxSide = Math.min(clampTo - 0.15, Math.acos(minFrontDot));
        finalAngle = baseAngle + sign * Math.max(0.35, maxSide);
      }
    }
    let [sx, sz] = dirFromAngle(finalAngle); // build dir from angle
    let sideDir = new THREE.Vector2(sx, sz);

    // Distance to frame full body
  let plannedFOV = 50;
  if (rigType === 'overhead') { plannedFOV = 60; }
  if (rigType === 'hard-cam') { plannedFOV = 46; }
    const fitDist = getFitDistance(bounds, plannedFOV, camera.aspect);
    let dist = Math.max(2.3, fitDist);

    // Ensure camera sits outside the ring rail
    const camXZ = new THREE.Vector2(
      currentCharacterPos[0] + sideDir.x * dist,
      currentCharacterPos[2] + sideDir.y * dist
    );

    // Final front-hemisphere safeguard using the actual candidate camera position
    if (fwd2 || yaw != null) {
      const fwd = fwd2 ?? new THREE.Vector2(...dirFromAngle((yaw ?? 0) + Math.PI));
      const toCam = new THREE.Vector2(
        camXZ.x - currentCharacterPos[0],
        camXZ.y - currentCharacterPos[2]
      ).normalize();
  const minFrontDot2 = 0.5; // also tighten the position-based check
      if (fwd.dot(toCam) < minFrontDot2) {
        const sign = Math.sign(diff || 1);
        const adjust = Math.min(clampTo - 0.15, Math.acos(minFrontDot2));
        const safeAngle = baseAngle + sign * Math.max(0.35, adjust);
        [sx, sz] = dirFromAngle(safeAngle);
        sideDir.set(sx, sz);
        camXZ.set(
          currentCharacterPos[0] + sideDir.x * dist,
          currentCharacterPos[2] + sideDir.y * dist
        );
      }
    }
    const camR = camXZ.length();
    if (camR < railRadius) {
      dist += (railRadius - camR) + 0.05;
    }

    let camY = currentCharacterPos[1] + 1.2; // base eye level
    // Keep camera above top rope
    const groundYCurrent = (agentPositions && agentPositions[0] && agentPositions[0][1] !== undefined)
      ? agentPositions[0][1]
      : -2.0;
    const ropeTopY = groundYCurrent + Math.max(0.85, Math.min(1.15, avgH * 0.68));
    camY = Math.max(camY, ropeTopY + 0.3);

    // Rig-specific vertical/feel adjustments
    if (rigType === 'corner-jib') {
      camY = ropeTopY + 0.9 + Math.sin(progress * Math.PI) * 0.3;
      dist *= 1.1;
    } else if (rigType === 'overhead') {
      camY = ropeTopY + 2.6;
      dist *= 1.2;
    }

    cameraPos.set(
      currentCharacterPos[0] + sideDir.x * dist,
      camY,
      currentCharacterPos[2] + sideDir.y * dist
    );

    // Keep camera strictly outside ring boundary (safety clamp)
    const camR2 = Math.hypot(cameraPos.x, cameraPos.z);
    if (camR2 < railRadius) {
      const k = railRadius / Math.max(1e-5, camR2);
      cameraPos.x *= k; cameraPos.z *= k;
    }
    
    // Add character-specific camera behavior
    if (currentCharacter) {
      switch (currentCharacter.name) {
        case 'Always Defect':
          // More aggressive, intimidating angles
          cameraPos.y += Math.sin(state.clock.elapsedTime * 0.8) * 0.2;
          break;
        case 'Random':
          // Chaotic, unpredictable movement
          tmpVecRef.current.set(
            Math.sin(state.clock.elapsedTime * 1.2) * 0.3,
            Math.cos(state.clock.elapsedTime * 1.5) * 0.2,
            Math.sin(state.clock.elapsedTime * 0.9) * 0.25
          );
          cameraPos.add(tmpVecRef.current);
          break;
        case 'Always Cooperate':
          // Gentle, peaceful movement
          tmpVecRef.current.set(
            Math.sin(state.clock.elapsedTime * 0.3) * 0.1,
            Math.cos(state.clock.elapsedTime * 0.25) * 0.05,
            0
          );
          cameraPos.add(tmpVecRef.current);
          break;
      }
    }
    
  // Smooth transition between shots
  const transitionProgress = Math.min(shotTimer.current / transitionDuration, 1);
  const easeProgress = 1 - Math.pow(1 - transitionProgress, 3); // Ease-out cubic
  const posLerp = transitionProgress < 1 ? (0.08 * easeProgress) : 0.035;
  const tgtLerp = transitionProgress < 1 ? (0.10 * easeProgress) : 0.05;
  cameraPositionRef.current.lerp(cameraPos, posLerp);
  cameraTargetRef.current.lerp(targetPos, tgtLerp);
    
    // Apply camera position and look-at
    camera.position.copy(cameraPositionRef.current);
    camera.lookAt(cameraTargetRef.current);
    
  // Add subtle hand-held sway; slightly stronger for aggressive characters
  const baseSway = 0.0035;
  const punch = (currentCharacter && ['Always Defect', 'Grim Trigger'].includes(currentCharacter.name)) ? 1.7 : 1.0;
  const t = state.clock.elapsedTime;
  camera.position.x += Math.sin(t * 1.7) * baseSway * punch;
  camera.position.y += Math.cos(t * 1.3) * baseSway * 0.6 * punch;
  camera.position.z += Math.sin(t * 1.1 + 1.3) * baseSway * 0.8 * punch;
    
  // Dynamic FOV tuned per rig
  let targetFOV = 50;
  if (rigType === 'hard-cam') { targetFOV = 46; }
  if (rigType === 'ringside-dolly') { targetFOV = 48; }
  if (rigType === 'corner-jib') { targetFOV = 58; }
  if (rigType === 'overhead') { targetFOV = 62; }
    
    const newFov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.01);
    if (Math.abs(newFov - camera.fov) > 0.01) {
      camera.fov = newFov;
      camera.updateProjectionMatrix();
    }

  // Occlusion fading: raycast from camera to target and fade intervening occluders
  // Increase cadence and use a small cone of rays so thin ropes get detected earlier
    if (occlusionTickRef.current >= 0.12) {
      occlusionTickRef.current = 0;
      const camPos = camera.position;
      const tgtPos = cameraTargetRef.current;
      const rayDir = tmpVecRef.current.subVectors(tgtPos, camPos);
      const maxDist = rayDir.length();
      if (maxDist > 1e-3) {
        // If we're very high or using an overhead rig, skip occlusion and restore
        const groundYCurrent = (agentPositions && agentPositions[0] && agentPositions[0][1] !== undefined)
          ? agentPositions[0][1]
          : -2.0;
        const avgH2 = (() => {
          const hs = (boundsByIndex || []).map(b => b && b.height).filter(Boolean);
          if (!hs.length) { return 1.6; }
          return hs.reduce((a, b) => a + b, 0) / hs.length;
        })();
        const ropeTopY2 = groundYCurrent + Math.max(0.85, Math.min(1.15, avgH2 * 0.68));
        if (rigType === 'overhead' || camera.position.y > ropeTopY2 + 1.2) {
          // Restore everything if we previously faded
          for (const prev of fadedRef.current) {
            const restoreMesh = (m) => {
              const orig = originalRef.current.get(m);
              if (!orig || !m.material) { return; }
              const restoreProps = (mm) => {
                if (!mm) { return; }
                mm.transparent = orig.transparent ?? false;
                mm.opacity = orig.opacity ?? 1;
                mm.depthWrite = orig.depthWrite ?? true;
                mm.needsUpdate = true;
              };
              if (Array.isArray(m.material)) { m.material.forEach(restoreProps); } else { restoreProps(m.material); }
            };
            if (prev.isMesh) { restoreMesh(prev); }
            if (prev.userData && prev.userData.agentIndex !== undefined && prev.traverse) {
              prev.traverse((child) => { if (child.isMesh) { restoreMesh(child); } });
            }
          }
          fadedRef.current = new Set();
          return;
        }
        rayDir.normalize();
        const ray = rayRef.current;
        const newFaded = new Set();
        const focusedIndex = currentCharacterIndex.current % Math.max(1, ring.length);

        // Build an orthonormal basis for a small sampling disk around the target line
        // Prefer a world-up reference but ensure non-degenerate
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(rayDir, up);
        if (right.lengthSq() < 1e-6) {
          up.set(0, 0, 1); // pick another up if looking straight up/down
          right.crossVectors(rayDir, up);
        }
        right.normalize();
        const upOrtho = new THREE.Vector3().crossVectors(right, rayDir).normalize();

        // Sample a few offsets around the center ray to catch thin ropes
        const avgH = (() => {
          const hs = (boundsByIndex || []).map(b => b && b.height).filter(Boolean);
          if (!hs.length) { return 1.6; }
          return hs.reduce((a, b) => a + b, 0) / hs.length;
        })();
  const sampleRadius = Math.max(0.04, Math.min(0.16, avgH * 0.045));
  const offsets = [ [0, 0], [1, 0], [0, 1] ];

        const tmpDir = new THREE.Vector3();
        const jittered = new THREE.Vector3();
        const castOnce = (origin, target) => {
          const dir = tmpDir.subVectors(target, origin);
          const dist = dir.length();
          if (dist <= 1e-3) { return; }
          dir.normalize();
          ray.set(origin, dir);
          ray.near = 0;
          ray.far = Math.max(0.01, dist - 0.005);
          // Only objects on layer 2 (cheap occlusion colliders and ring meshes), using our compact list
          const hits = ray
            .intersectObjects(occluderListRef.current, true)
            .filter(h => h.object.layers && h.object.layers.test(ray.layers));
          for (const h of hits) {
            if (h.distance >= dist - 0.02) { break; }
            const hitObject = h.object;
            let obj = hitObject;
            let toFade = null;
            let agentIdx;
            // 1) If we intersect an agent proxy/child, fade the whole agent group (root with agentIndex)
            while (obj) {
              if (obj.userData && obj.userData.agentIndex !== undefined) {
                agentIdx = obj.userData.agentIndex;
                toFade = obj; // fade agent root group
                break;
              }
              obj = obj.parent;
            }
            // 2) Otherwise, for stage geometry (ring, ropes, posts), only fade the exact hit mesh
            if (!toFade) {
              let mesh = hitObject;
              while (mesh && !mesh.isMesh) { mesh = mesh.parent; }
              if (mesh && mesh.isMesh) { toFade = mesh; }
            }

            if (toFade && (agentIdx === undefined ? true : agentIdx !== focusedIndex)) {
              newFaded.add(toFade);
            }
          }
        };

        // Center ray plus small cone around it (toward the target)
        for (let i = 0; i < offsets.length; i++) {
          const ox = offsets[i][0];
          const oy = offsets[i][1];
          jittered.copy(tgtPos)
            .addScaledVector(right, ox * sampleRadius)
            .addScaledVector(upOrtho, oy * sampleRadius);
          castOnce(camPos, jittered);
          if (newFaded.size >= 3) { break; }
        }

          const applyFade = (node) => {
          const applyMesh = (m) => {
            if (!m) { return; }
            const mat = m.material;
            if (!mat) { return; }
            const firstMat = Array.isArray(mat) ? mat[0] : mat;
            const orig = originalRef.current.get(m) || {
              transparent: firstMat.transparent,
              opacity: firstMat.opacity,
              depthWrite: firstMat.depthWrite,
            };
            if (!originalRef.current.has(m)) {
              originalRef.current.set(m, orig);
            }
            // Clone material once per mesh to avoid shared-material global fades
            if (!m.userData) { m.userData = {}; }
            if (!m.userData._occlusionCloned) {
              if (Array.isArray(m.material)) {
                m.material = m.material.map((mm) => mm && mm.clone ? mm.clone() : mm);
              } else {
                m.material = m.material.clone();
              }
              m.userData._occlusionCloned = true;
            }
            const applyProps = (mm) => {
              if (!mm) { return; }
              mm.transparent = true;
              // Slightly higher opacity so ropes are still readable but clearly faded
              mm.opacity = 0.22;
              mm.depthWrite = false;
              mm.needsUpdate = true;
            };
            if (Array.isArray(m.material)) { m.material.forEach(applyProps); } else { applyProps(m.material); }
          };
          // Only apply to the node itself; do not traverse up to groups for stage geometry
          if (node.isMesh) { applyMesh(node); }
          // If node is an agent group (we selected it by agentIndex), apply to its meshes
          if (node.userData && node.userData.agentIndex !== undefined && node.traverse) {
            node.traverse((child) => { if (child.isMesh) { applyMesh(child); } });
          }
        };

        const restoreNode = (node) => {
          const restoreMesh = (m) => {
            const orig = originalRef.current.get(m);
            if (!orig || !m.material) { return; }
            const restoreProps = (mm) => {
              if (!mm) { return; }
              mm.transparent = orig.transparent ?? false;
              mm.opacity = orig.opacity ?? 1;
              mm.depthWrite = orig.depthWrite ?? true;
              mm.needsUpdate = true;
            };
            if (Array.isArray(m.material)) { m.material.forEach(restoreProps); } else { restoreProps(m.material); }
          };
          // Only restore the specific mesh or, if agent group, its meshes
          if (node.isMesh) {
            restoreMesh(node);
          }
          if (node.userData && node.userData.agentIndex !== undefined && node.traverse) {
            node.traverse((child) => { if (child.isMesh) { restoreMesh(child); } });
          }
        };

        for (const prev of fadedRef.current) {
          if (!newFaded.has(prev)) { restoreNode(prev); }
        }
        for (const cur of newFaded) { applyFade(cur); }
        fadedRef.current = newFaded;
      }
    }
  });
  
  return null;
}

// Debug overlay: visualizes per-agent footprint circles and draws red lines for overlaps
function CollisionDebugger({ positions = [], radii = [], groundY = 0, verbose = false }) {
  const collisions = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < positions.length; i++) {
      const pi = positions[i];
      if (!pi) {
        continue;
      }
      const ri = radii[i] ?? 0.35;
      for (let j = i + 1; j < positions.length; j++) {
        const pj = positions[j];
        if (!pj) {
          continue;
        }
        const rj = radii[j] ?? 0.35;
        const dx = pi[0] - pj[0];
        const dz = pi[2] - pj[2];
        const d2 = dx * dx + dz * dz;
        const minD = ri + rj;
        if (d2 < minD * minD) {
          pairs.push({ i, j, a: pi, b: pj });
        }
      }
    }
    return pairs;
  }, [positions, radii]);

  useEffect(() => {
    if (!verbose) { return; }
    if (collisions.length) {
      console.info(`[CollisionDebugger] overlaps: ${collisions.length}`);
    }
  }, [collisions.length, verbose]);

  return (
    <group>
      {positions.map((p, idx) => {
        if (!p) {
          return null;
        }
        const r = Math.max(0.15, radii[idx] ?? 0.35);
        return (
          <mesh key={`fp-${idx}`} rotation={[-Math.PI / 2, 0, 0]} position={[p[0], groundY + 0.01, p[2]]} renderOrder={998}>
            <ringGeometry args={[r * 0.88, r, 48]} />
            <meshBasicMaterial color="#00ff88" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        );
      })}
      {collisions.map((c, k) => {
        const pts = new Float32Array([
          c.a[0], groundY + 0.02, c.a[2],
          c.b[0], groundY + 0.02, c.b[2],
        ]);
        return (
          <line key={`col-${k}`} renderOrder={999}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" array={pts} itemSize={3} count={2} />
            </bufferGeometry>
            <lineBasicMaterial color="#ff3355" linewidth={1} />
          </line>
        );
      })}
    </group>
  );
}
// Lightweight ring pulse emitter that plays a few expanding waves when triggered
function WaveEmitter({ action, interactionKey }) {
  const group = useRef();
  const rings = [useRef(), useRef(), useRef()];
  const lightRef = useRef();
  const pulsesRef = useRef([]); // [{t0:number, color:string}]
  const lastKeyRef = useRef(null);

  // Map action to glow color
  const color = action === 'D' ? '#ff2d2d' : action === 'C' ? '#00ffc6' : null;

  // On new interaction for this agent, queue up 3 staggered pulses
  useEffect(() => {
    if (!color) {
      return;
    }
    if (interactionKey && interactionKey !== lastKeyRef.current) {
      lastKeyRef.current = interactionKey;
      const now = performance.now() / 1000;
      pulsesRef.current = [
        { t0: now + 0.00, color },
        { t0: now + 0.12, color },
        { t0: now + 0.24, color },
      ];
    }
  }, [interactionKey, color]);

  // Animate ring expansion & light pulse
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const duration = 1.2; // seconds per wave
    const maxRadius = 2.6; // world units
    const minRadius = 0.2;
    const thickness = 0.12; // base thickness of ring

    let anyActive = false;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i].current;
      const pulse = pulsesRef.current[i];
      if (!ring || !pulse) {
        if (ring) {
          ring.visible = false;
        }
        continue;
      }
      const age = t - pulse.t0;
      if (age < 0 || age > duration) { ring.visible = false; continue; }
      anyActive = true;

      const k = age / duration; // 0..1
      const radius = minRadius + (maxRadius - minRadius) * k;
      const opacity = (1 - k) * 0.7; // fade out

      // Scale ring outward; keep y slightly above ground to avoid z-fighting
      ring.visible = true;
      ring.position.set(0, 0.02, 0);
      const s = radius / 1.0; // geometry base outer radius ~1.0, adjust below
      ring.scale.setScalar(Math.max(0.0001, s));
      if (ring.material) {
        ring.material.opacity = opacity;
        ring.material.color.set(pulse.color);
      }
    }

    // Pulse a small point light for extra glow
    if (lightRef.current) {
      if (!color || !anyActive) {
        lightRef.current.intensity = 0;
      } else {
        // Tie intensity to the most recent active pulse
        const latest = pulsesRef.current.find(p => t >= p.t0 && t <= p.t0 + duration);
        if (latest) {
          const k = 1 - (t - latest.t0) / duration;
          lightRef.current.intensity = 0.6 * k;
          lightRef.current.color.set(latest.color);
        } else {
          lightRef.current.intensity = 0;
        }
      }
    }
  });

  // Base geometry: a ring (outer radius 1, inner radius 0.88) scaled up over time
  return (
    <group ref={group}>
      {rings.map((ref, i) => (
        <mesh key={i} ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={999}>
          <ringGeometry args={[0.88, 1.0, 64]} />
          <meshBasicMaterial transparent opacity={0.0} depthWrite={false} blending={THREE.AdditiveBlending} color={color || '#ffffff'} />
        </mesh>
      ))}
      <pointLight ref={lightRef} position={[0, 0.6, 0]} intensity={0} distance={3} color={color || '#ffffff'} />
    </group>
  );
}

// Crown 3D component for the leader
function Crown3D({ position, averageHeight = 1.6, agentBounds = null }) {
  const [crownModel, setCrownModel] = useState(null);
  const [loading, setLoading] = useState(true);

  // Calculate appropriate crown scale based on player height
  const crownScale = useMemo(() => {
    // Use individual agent height if available, otherwise fall back to average
    const effectiveHeight = agentBounds?.height || averageHeight;
    
    // Base the crown size on the individual agent's height
    // A crown should be roughly 15-20% of head height, and head is ~12% of total height
    const headHeight = effectiveHeight * 0.12;
    const crownHeightRatio = 0.18; // Crown is ~18% of head height
    const targetCrownHeight = headHeight * crownHeightRatio;
    
    // The crown model's base size needs to be determined empirically
    // Starting with 0.015 and adjusting based on player scale
  const baseScale = 0.015;
  const heightAdjustment = effectiveHeight / 1.6; // Normalize to default 1.6 height
  // Return directly to satisfy linter about inlined variables
  return baseScale * heightAdjustment * 0.6 * 0.5 * 0.5 * 1.25; // Increase by 25%
  }, [averageHeight, agentBounds]);

  useEffect(() => {
    const loadCrown = async () => {
      const loader = new FBXLoader();
  const path = import.meta.env.BASE_URL + 'character_3dmodels/crown/base_basic_shaded.fbx';
      
      try {
        const fbx = await new Promise((resolve, reject) => {
          loader.load(
            path,
            (obj) => resolve(obj),
            (progress) => {
              // Optional: could add progress logging if needed
            },
            (error) => reject(error)
          );
        });

        // Set materials and shadows
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              // Make it golden
              child.material.color.setHex(0xFFD700);
              child.material.needsUpdate = true;
            }
          }
        });

        setCrownModel(fbx);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load crown model:', error);
        setLoading(false);
      }
    };

    loadCrown();
  }, []);

  // Calculate crown height offset based on individual agent's height
  const crownHeightOffset = useMemo(() => {
    // Use individual agent bounds if available
    if (agentBounds && agentBounds.height) {
      // Crown should hover above the actual model's top
      // Use the agent's actual height plus a small margin
      const agentHeight = agentBounds.height;
      const crownMargin = agentHeight * 0.15; // 15% of agent height as margin above head
      return agentHeight + crownMargin;
    }
    
    // Fallback to average height calculation
    const effectiveHeight = averageHeight;
    // Crown should hover above the head, which is roughly at 90% of total height
    const headTopY = effectiveHeight * 0.9;
    const crownMargin = effectiveHeight * 0.1; // Small margin above head
    return headTopY + crownMargin;
  }, [averageHeight, agentBounds]);

  if (loading || !crownModel) {
    // Fallback to the original golden sphere while loading, scaled appropriately
    const effectiveHeight = agentBounds?.height || averageHeight;
    const fallbackRadius = 0.15 * (effectiveHeight / 1.6) * 0.8 * 0.5 * 0.5 * 1.25; // Scale sphere with individual agent height and match crown scale
    return (
      <mesh position={[position[0], position[1] + crownHeightOffset, position[2]]} renderOrder={1000}>
        <sphereGeometry args={[fallbackRadius, 8, 8]} />
        <meshBasicMaterial color="#FFD700" transparent opacity={0.8} />
      </mesh>
    );
  }

  return (
    <group position={[position[0], position[1] + crownHeightOffset, position[2]]} scale={[crownScale, crownScale, crownScale]} renderOrder={1000}>
      <primitive object={crownModel} />
    </group>
  );
}

// Nameplate for the currently focused agent: sits above and slightly to the side (screen-right)
function FocusNameplate({ position = [0,0,0], height = 1.6, label = '' }) {
  const { camera } = useThree();
  const groupRef = useRef();

  useFrame(() => {
    const g = groupRef.current;
    if (!g) { return; }
    // Base point: top of head
    const base = new THREE.Vector3(position[0], position[1] + height + 0.05, position[2]);
    // Camera-based right/up offset so the plate avoids occluding the face
    const camTo = new THREE.Vector3().subVectors(camera.position, base).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, camTo).normalize();
    const offset = right.multiplyScalar(0.28).add(new THREE.Vector3(0, 0.14, 0));
    base.add(offset);
    g.position.copy(base);
  });

  return (
    <group ref={groupRef}>
      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          padding: '6px 10px',
          borderRadius: 999,
          fontWeight: 700,
          fontSize: 13,
          color: '#111',
          background: 'linear-gradient(135deg, #ffffff 0%, #f6f6f6 100%)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          border: '1px solid rgba(0,0,0,0.06)'
        }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

function Agent({ name, position, isClassic, isInteracting, isLeader = false, onClick, onBoundsComputed, index, lookAtTarget, action, interactionKey, hitRadius = 0.4, hitHeight = 1.6 }) {
  const groupRef = useRef();
  const mixerRef = useRef();
  const [fbxModel, setFbxModel] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const animAccumRef = useRef(0);
  
  // Memoize the position to prevent unnecessary re-renders
  const memoizedPosition = useMemo(() => position, [position[0], position[1], position[2]]);
  
  // Load the 3D model based on agent name
  useEffect(() => {
    const loadModel = async () => {
      const loader = new FBXLoader();
      
      try {
        let modelPath = '';
        
        // Map agent names to model files
        switch (name) {
          case 'Always Defect':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/alwaysDefect/Uppercut Jab.fbx';
            break;
          case 'Always Cooperate':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/alwaysCooperate/Injured Idle.fbx';
            break;
          case 'Tit-for-Tat':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/titForTat/Fight Idle.fbx';
            break;
          case 'Grim Trigger':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/grimTrigger/Angry.fbx';
            break;
          case 'Generous Tit-for-Tat':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/generousTitForTat/Happy Idle.fbx';
            break;
          case 'Random':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/random/Swing Dancing.fbx';
            break;
          case 'Q-Learning Agent':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/qLearningAgent/Standing Using Touchscreen Tablet.fbx';
            break;
          case 'Frequency Analyzer':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/frequencyAnalyzer/Walking While Texting.fbx';
            break;
          case 'Pattern Detective':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/patternDetective/Look Around.fbx';
            break;
          case 'Meta-Strategist':
            modelPath = '/AiGameTheoryFishbowl-PrisonersDilemma/character_3dmodels/metaStrategist/Low Crawl.fbx';
            break;
          default:
            // Fallback to a placeholder or return early
            console.log(`No 3D model configured for character: ${name}`);
            return;
        }
        
        const fbx = await new Promise((resolve, reject) => {
          loader.load(
            modelPath,
            (object) => resolve(object),
            (progress) => {
              if (!DEBUG) { return; }
              const pct = Math.round((progress.loaded / progress.total) * 100);
              // Sample logs every ~10% to avoid spamming the console
              if (pct % 10 === 0 && pct !== fbx.userData?._lastPct) {
                fbx.userData = fbx.userData || {};
                fbx.userData._lastPct = pct;
                console.log(`Loading ${name}:`, pct + '%');
              }
            },
            (error) => reject(error)
          );
        });
        
        // Scale the model appropriately
        fbx.scale.setScalar(0.01);
        
        // Ensure proper material setup and disable heavy raycasts on FBX child meshes
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // Disable raycasting on complex geometry; we'll use a simple proxy collider instead
            // This avoids per-frame BVH traversal over large meshes on pointer move
            child.raycast = () => {};
            // Keep FBX meshes off occlusion layer to reduce ray hits
            if (child.layers) { child.layers.disable(2); }
            if (child.material) {
              child.material.needsUpdate = true;
              if (child.material.map) {
                child.material.map.generateMipmaps = false;
              }
            }
          }
        });
        
        // Setup animations if they exist - look for idle animation
        if (fbx.animations && fbx.animations.length > 0) {
          if (DEBUG) { console.log(`Found ${fbx.animations.length} animations for ${name}:`, fbx.animations.map(a => a.name)); }
          
          const mixer = new THREE.AnimationMixer(fbx);
          
          // Find idle animation or use first animation
          const idleAnimation = fbx.animations.find(anim => 
            anim.name.toLowerCase().includes('idle') || 
            anim.name.toLowerCase().includes('breathing') ||
            anim.name.toLowerCase().includes('standing')
          ) || fbx.animations[0];
          
          const action = mixer.clipAction(idleAnimation);
          action.setLoop(THREE.LoopRepeat);
          action.clampWhenFinished = false;
          action.play();
          
          mixerRef.current = mixer;
          if (DEBUG) { console.log(`Playing animation "${idleAnimation.name}" for ${name}`); }
        } else {
          if (DEBUG) { console.log(`No animations found for ${name}`); }
        }
        
        // Compute bounds for framing once the model is available
        const tempGroup = new THREE.Group();
        tempGroup.add(fbx);
        const box = new THREE.Box3().setFromObject(tempGroup);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        // Height and width in world units (consider scale already applied)
        const bounds = {
          height: Math.max(0.5, size.y),
          width: Math.max(0.3, Math.max(size.x, size.z)),
          centerY: center.y - box.min.y > 0 ? (box.min.y + size.y * 0.5) : 0.8,
        };
        if (onBoundsComputed) {
          onBoundsComputed(index, bounds);
        }

        setFbxModel(fbx);
        setIsLoaded(true);
      } catch (error) {
        console.error('Error loading model for', name, ':', error);
        setIsLoaded(true); // Still set loaded to show fallback
      }
    };
    
    loadModel();
    
    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
    };
  }, [name]);
  
  // Smooth animation loop - separated from simulation updates
  useFrame((state, delta) => {
    // Update animation mixer for character animations
    if (mixerRef.current) {
      // LOD-style animation stepping to reduce CPU while keeping average speed
      const cam = state.camera;
      const gp = groupRef.current;
      let stepHz = 60; // default
      if (gp) {
        const dx = gp.position.x - cam.position.x;
        const dz = gp.position.z - cam.position.z;
        const dy = gp.position.y - cam.position.y;
        const dist2 = dx * dx + dy * dy + dz * dz;
        // Camera forward
        const f = new THREE.Vector3(); cam.getWorldDirection(f);
        const to = new THREE.Vector3(dx, dy, dz).normalize();
        const facing = f.dot(to); // >0 in front, <0 behind
        // Priority ladder
        if (isInteracting || isLeader) {
          stepHz = 60;
        } else if (dist2 < 16) { // <4m
          stepHz = 30;
        } else if (dist2 < 64 && facing > -0.25) { // <8m and not far behind
          stepHz = 20;
        } else {
          stepHz = 10; // distant/behind
        }
      }
      const step = 1 / stepHz;
      animAccumRef.current += delta;
      if (animAccumRef.current >= step) {
        const d = animAccumRef.current;
        animAccumRef.current = 0;
        mixerRef.current.update(d);
      }
    }
    
    if (groupRef.current) {
      // Gentle floating animation (very subtle)
      const floatOffset = Math.sin(state.clock.elapsedTime * 0.5 + memoizedPosition[0]) * 0.05;
      groupRef.current.position.y = memoizedPosition[1] + floatOffset;
      
  // Keep consistent scale (remove old pulsing effect)
  groupRef.current.scale.setScalar(1);

      // Smoothly turn to face current opponent during interaction (yaw only)
      if (isInteracting && lookAtTarget) {
        const posX = groupRef.current.position.x;
        const posZ = groupRef.current.position.z;
        const targetX = lookAtTarget[0];
        const targetZ = lookAtTarget[2];
        // Desired yaw so that +Z forward faces the target
        const desiredYaw = Math.atan2(targetX - posX, targetZ - posZ);
        let currentYaw = groupRef.current.rotation.y;
        // Wrap delta to [-PI, PI] for shortest rotation
        let deltaYaw = desiredYaw - currentYaw;
        deltaYaw = ((deltaYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
        // Critically-damped smoothing
        const turnSpeed = 10; // higher = faster turn
        currentYaw += deltaYaw * (1 - Math.exp(-turnSpeed * delta));
        groupRef.current.rotation.y = currentYaw;
      }
    }
  });
  
  // Fallback visual (raycast disabled; events handled by proxy collider)
  const fallbackVisual = (
    <mesh raycast={() => {}}>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshStandardMaterial 
        color={isClassic ? '#4f46e5' : '#059669'} 
        emissive={isInteracting ? '#ffffff' : '#000000'}
        emissiveIntensity={isInteracting ? 0.2 : 0}
      />
    </mesh>
  );
  
  return (
    <group
      ref={groupRef}
      position={memoizedPosition}
      userData={{ agentIndex: index }}
    >
      {(isLoaded && fbxModel) ? (
        <primitive object={fbxModel} />
      ) : (
        fallbackVisual
      )}
      {/* Invisible, simple proxy collider to handle all pointer interactions cheaply */}
      <mesh
        position={[0, Math.max(0.5, hitHeight * 0.5), 0]}
  userData={{ occlusionEligible: true }}
  layers={2}
        onClick={(e) => { e.stopPropagation(); onClick(name); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
      >
        <cylinderGeometry args={[Math.max(0.22, hitRadius), Math.max(0.22, hitRadius), Math.max(1.0, hitHeight), 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Action-based glow waves (additive, non-intrusive on model materials) */}
      {isInteracting && (
        <WaveEmitter action={action} interactionKey={interactionKey} />
      )}
    </group>
  );
}

// Boxing ring floor replacement: loads an FBX, scales to fit agent ring, aligns top to groundY
function BoxingRing({ desiredRadius = 3, groundY = -1.8, averageHeight = 1.6 }) {
  const groupRef = useRef();
  const [model, setModel] = useState(null);
  const [ready, setReady] = useState(false);
  const [ringScale, setRingScale] = useState(1);
  const [ringYOffset, setRingYOffset] = useState(0);
  const centerRef = useRef(new THREE.Vector3());
  const [showHelpers, setShowHelpers] = useState(false);

  // Find a likely flat platform top by histogramming vertex Y positions
  function findPlatformY(object, box) {
    const yValues = [];
    object.traverse((child) => {
      if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
        const pos = child.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          yValues.push(y);
        }
      }
    });
    if (yValues.length === 0) {
      const size = new THREE.Vector3(); box.getSize(size);
      return box.min.y + size.y * 0.08; // fallback guess
    }
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const range = Math.max(1e-6, maxY - minY);
    const binSize = range / 200; // 200 bins across height
    const bins = new Map();
    for (const y of yValues) {
      const key = Math.floor((y - minY) / binSize);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    // Prefer a dense, lower-third horizontal band
    let bestKey = -1, bestCount = -1;
    for (const [k, count] of bins.entries()) {
      const yCenter = minY + (k + 0.5) * binSize;
      const ratio = (yCenter - minY) / range;
      if (ratio > 0.05 && ratio < 0.45 && count > bestCount) {
        bestCount = count; bestKey = k;
      }
    }
    if (bestKey === -1) {
      // fallback: densest overall bin
      for (const [k, count] of bins.entries()) {
        if (count > bestCount) { bestCount = count; bestKey = k; }
      }
    }
    return minY + (bestKey + 0.5) * binSize;
  }

  useEffect(() => {
    const loader = new FBXLoader();
    // Use direct path to known file location
  const path = import.meta.env.BASE_URL + 'boxingRing/base_basic_shaded.fbx';
  if (DEBUG) { console.log('[BoxingRing] loading', path); }
    loader.load(
      path,
      (obj) => {
        // Set materials/shadows
        obj.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.layers) { child.layers.enable(2); }
            if (child.material) {
              child.material.needsUpdate = true;
            }
          }
        });

        // Compute bounds
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        centerRef.current.copy(center);

  // Scale ring based on player height and desired circle radius
  const ringFootprint = Math.max(size.x, size.z);
  const h = Math.max(0.5, averageHeight || 1.6);
  const padding = h * 0.75; // extra breathing room beyond agents' circle diameter
  const targetDiameter = Math.max(2 * desiredRadius + padding, h * 4.5);
  const s = ringFootprint > 0 ? targetDiameter / ringFootprint : 1.0;
  setRingScale(s);

        // Calculate proper platform position
        // The ring platform should be at the character's groundY level (-1.8)
        // So we need to position the ring so its platform surface aligns with groundY
        
        // Estimate where the platform surface is in the original model
        // For a boxing ring, the platform surface is typically very close to the bottom
        // Reducing this ratio significantly to lower the ring platform
        const platformHeightRatio = 0.02; // platform is ~2% up from the bottom (much lower)
        const platformLocalY = box.min.y + (size.y * platformHeightRatio);
        
  // Position the ring so this platform surface ends up near groundY (players' feet level)
  // Use a tiny epsilon to mitigate z-fighting and a small downward nudge for thicker soles
  const footEpsilon = 0.02;
  const nudgeDown = Math.max(0, (averageHeight || 1.6) * 0.25); // lower by ~25% of avg height
  const kneeDown = Math.max(0, (averageHeight || 1.6) * 0.29); // additional shift: approx knee height
  const fineTuneDown = 0.08; // slight additional lowering
  const y = groundY - (platformLocalY * s) + footEpsilon - nudgeDown - kneeDown - fineTuneDown;
        setRingYOffset(y);

        setModel(obj);
        setReady(true);
  if (DEBUG) { console.log('[BoxingRing] ready', { 
          originalSize: size.toArray(), 
          scale: s, 
          yOffset: y, 
          finalFootprint: ringFootprint * s 
  }); }
      },
      undefined,
      (err) => {
        console.error('[BoxingRing] failed to load', path, err?.message || err);
      }
    );
  }, [desiredRadius, groundY, averageHeight]);  // Keyboard nudge controls for quick tuning if alignment is off
  useEffect(() => {
    const onKey = (e) => {
      const { key } = e;
      if (key === '[') { setRingYOffset((y) => y - 0.05); }
      if (key === ']') { setRingYOffset((y) => y + 0.05); }
      if (key === '-') { setRingScale((s) => s * 0.98); }
      if (key === '=' || key === '+') { setRingScale((s) => s * 1.02); }
      if (key.toLowerCase() === 'h') { setShowHelpers((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready || !model) {
    // Fallback receiver so characters don't float if FBX is still loading
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY + 0.001, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
    );
  }

  return (
    <group
      ref={groupRef}
  userData={{ occlusionEligible: true }}
  layers={2}
  position={[-centerRef.current.x * ringScale, ringYOffset, -centerRef.current.z * ringScale]}
  scale={[ringScale, ringScale, ringScale]}
      frustumCulled={false}
    >
      <primitive object={model} />
      {showHelpers && (
        <>
          <axesHelper args={[1.5]} />
          {(() => {
            const box = new THREE.Box3().setFromObject(model);
            const helper = new THREE.Box3Helper(box, 0x00ff88);
            return <primitive object={helper} />;
          })()}
        </>
      )}
    </group>
  );
}

// Main ThreeFishbowl Component
export default function ThreeFishbowl({ ring = [], interaction = null, onAgentClick = () => {}, hideOverlays = false }) {
  const [boundsByIndex, setBoundsByIndex] = useState([]);
  const [simPositions, setSimPositions] = useState([]);
  const [focusedIndex, setFocusedIndex] = useState(0); // camera focus shared from CinematicCamera
  const [debugCollisions, setDebugCollisions] = useState(false);
  const [showLeaderDebug, setShowLeaderDebug] = useState(false);
  const [showScoreLabels, setShowScoreLabels] = useState(false);
  const [showCenterMarker, setShowCenterMarker] = useState(false);
  // Track leader changes and prior positions to support dethroning swap behavior
  const prevLeaderRef = useRef(null);
  const lastPositionsRef = useRef([]);
  // Reflection-only environment configuration (no background)
  const [envPreset, setEnvPreset] = useState('sunset'); // start with a visible sky
  const [envRotation, setEnvRotation] = useState(0); // radians
  const [envIntensity, setEnvIntensity] = useState(0.45); // low to avoid haze
  const [envBackground, setEnvBackground] = useState(true); // show HDRI as background
  const handleBoundsComputed = (idx, bounds) => {
    setBoundsByIndex(prev => {
      const next = [...prev];
      next[idx] = bounds;
      return next;
    });
  };
  // Keep refs to agent wrapper groups so camera can read orientations
  const agentGroupRefs = useRef([]);
  // Average player height from loaded models (fallback to 1.6 if unknown)
  const averageHeight = useMemo(() => {
    const heights = boundsByIndex.map(b => b && b.height).filter(Boolean);
    if (!heights.length) {
      return 1.6;
    }
    return heights.reduce((a, b) => a + b, 0) / heights.length;
  }, [boundsByIndex]);
  // Simple keyboard toggle for environment presets
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'e') {
        setEnvPreset((p) => (p === 'studio' ? 'warehouse' : 'studio'));
      }
      if (e.key.toLowerCase() === 'r') {
        setEnvRotation((r) => r + Math.PI / 8);
      }
      if (e.key.toLowerCase() === 'b') {
        setEnvBackground((b) => !b);
      }
      if (e.key.toLowerCase() === 'c') {
        setDebugCollisions((v) => !v);
      }
      if (e.key.toLowerCase() === 'l') {
        setShowLeaderDebug((v) => !v);
      }
      if (e.key.toLowerCase() === 'v') {
        setShowScoreLabels((v) => !v);
      }
      if (e.key.toLowerCase() === 'm') {
        setShowCenterMarker((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Footprint and ground constants used by both players and ring to stay consistent
  const DESIRED_RADIUS = 3;
  const GROUND_Y = -2.29;

  // Robust score extraction across possible shapes
  const getAgentScore = (agent) => {
    if (!agent) {
      return 0;
    }
    
    // First check if score is directly available (as passed from GameTheoryFishbowl)
    if (typeof agent.score === 'number') {
      return agent.score;
    }
    
    const toNumberish = (val) => {
      if (val == null) {
        return null;
      }
      if (typeof val === 'number' && Number.isFinite(val)) {
        return val;
      }
      if (typeof val === 'string') {
        // Extract first numeric token from the string, e.g., "12 pts" => 12
        const m = val.match(/-?\d+(?:\.\d+)?/);
        if (m) {
          const v = parseFloat(m[0]);
          if (Number.isFinite(v)) {
            return v;
          }
        }
        return null;
      }
      if (typeof val === 'object') {
        const cand = toNumberish(val.value ?? val.total ?? val.amount ?? val.score);
        if (cand != null) {
          return cand;
        }
        // last resort: try toString
        const s = String(val);
        const m = s.match(/-?\d+(?:\.\d+)?/);
        if (m) {
          const v = parseFloat(m[0]);
          if (Number.isFinite(v)) {
            return v;
          }
        }
      }
      return null;
    };

    const tryKeys = [
      // common score-like fields (ordered by typical reliability)
      'totalScore', 'points', 'currentScore', 'cumulativeScore', 'wins',
      // other plausible fields used in leaderboards/payoffs
      'totalPoints', 'total_points', 'payoff', 'totalPayoff', 'payoffs', 'reward', 'totalReward',
      'scoreDisplay', 'displayScore', 'leaderScore', 'elo', 'fitness', 'utility', 'value', 'val', 'sum', 'accumulated', 'accum'
    ];
    for (const k of tryKeys) {
      const v = toNumberish(agent?.[k]);
      if (v != null) {
        console.log(`[Score Found] ${agent.name} - ${k}: ${v}`);
        return v;
      }
    }
    // Nested fallbacks
    const nestedPaths = [
      ['stats', 'score'],
      ['leaderboard', 'score'],
      ['scores', 'total'],
      ['summary', 'score'],
      ['results', 'score'],
      ['result', 'total'],
      ['metrics', 'total'],
      ['state', 'score']
    ];
    for (const path of nestedPaths) {
      let cur = agent;
      for (const key of path) {
        cur = cur?.[key];
      }
      const v = toNumberish(cur);
      if (v != null) {
        console.log(`[Score Found] ${agent.name} - ${path.join('.')}: ${v}`);
        return v;
      }
    }
    
    console.log(`[Score NOT Found] ${agent.name} - defaulting to 0`);
    return 0;
  };

  // Throttle score computations to reduce CPU churn on large casts (outside R3F loop)
  const [scoreSignature, setScoreSignature] = useState('');
  useEffect(() => {
    let mounted = true;
    const id = setInterval(() => {
      const sig = (ring || []).map(a => getAgentScore(a)).join('|');
      if (mounted) {
        setScoreSignature(prev => (sig !== prev ? sig : prev));
      }
    }, 500); // ~2 Hz
    return () => { mounted = false; clearInterval(id); };
  }, [ring]);

  // Compute current leader index by highest score (ties: first)
  const leaderIndex = useMemo(() => {
    if (!ring || ring.length === 0) {
      return -1;
    }
    // compute scores array
    const scores = ring.map(getAgentScore);
    const max = scores.reduce((m, v) => (v > m ? v : m), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(max)) {
      return ring[0] ? 0 : -1;
    }
    // collect all leaders with max score
    const leaders = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] === max) {
        leaders.push(i);
      }
    }
    
    // DEBUG: Force strict leader selection without previous leader bias
    // This should make the king switch immediately when scores change
    const result = leaders.length ? leaders[0] : (ring[0] ? 0 : -1);
    
    // Log leader selection process
  if (DEBUG && typeof console !== 'undefined') {
      console.log('[Leader Selection]', {
        scores,
        max,
        leaders,
        selected: result,
        selectedName: ring[result]?.name
      });
    }
    
    return result;
  }, [ring, scoreSignature]);

  // Debug: log computed scores each time they change
  useEffect(() => {
    if (!ring || ring.length === 0) {
      return;
    }
    try {
      const rows = ring.map((a, i) => ({ 
        index: i, 
        name: a?.name, 
        rawAgent: a, 
        score: getAgentScore(a),
        isCurrentLeader: i === leaderIndex
      }));
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.group('[Scores Debug]');
        // eslint-disable-next-line no-console
        console.table(rows);
        // eslint-disable-next-line no-console
        console.log('Current leader index:', leaderIndex);
        // eslint-disable-next-line no-console
        console.log('Previous leader index:', prevLeaderRef.current);
        // eslint-disable-next-line no-console
        console.groupEnd();
      }
    } catch {}
  }, [scoreSignature, leaderIndex]);

  // Estimate footprint radii for each agent from loaded bounds (used for debug and spacing intuition)
  const footprintRadii = useMemo(() => {
    return new Array(ring.length).fill(0).map((_, i) => {
      const w = boundsByIndex[i]?.width ?? 0.6;
      // radius is a fraction of width with a small buffer; clamp to reasonable range
      return Math.max(0.22, Math.min(0.6, w * 0.45));
    });
  }, [ring.length, boundsByIndex]);

  // Arrange players inside ring using 1-3 concentric circles to avoid rope clipping
  const agentPositions = useMemo(() => {
    const n = ring.length;
    if (!n) {
      return [];
    }
    const leadingPlayerIndex = leaderIndex;
    // Debug: Log leader information
    if (leadingPlayerIndex !== -1 && DEBUG) {
      console.log(`[Leader] ${ring[leadingPlayerIndex].name} with score ${ring[leadingPlayerIndex].score || 0} at center`);
    }

    const avgH = (() => {
      const hs = boundsByIndex.map(b => b && b.height).filter(Boolean);
      if (!hs.length) { return 1.6; }
      return hs.reduce((a, b) => a + b, 0) / hs.length;
    })();
    const avgW = (() => {
      const ws = boundsByIndex.map(b => b && b.width).filter(Boolean);
      if (!ws.length) { return 0.6; }
      return ws.reduce((a, b) => a + b, 0) / ws.length;
    })();

  // Keep some distance from ropes but allow more outward usage
  const ropeMargin = Math.max(0.4, avgH * 0.30);
  const safeRadius = Math.max(1.6, DESIRED_RADIUS - ropeMargin);

  // Minimum spacing between neighbors on the same ring (arc length)
  // Increase slightly to avoid crowded arcs
  const minArcSpacing = Math.max(1.5, avgW * 2.4 + 0.45);
    const capacityAt = (r) => Math.max(1, Math.floor((2 * Math.PI * Math.max(0.01, r)) / minArcSpacing));

  // Enforce radial clearance between rings; push rings apart a bit more
  const minRadialSpacing = Math.max(0.9, avgW * 1.5);

  // Choose radii (outer, mid, inner) to better use available space (allow closer to ropes)
  const R3 = Math.max(0.9, safeRadius * 0.998);   // outer ring very near safe boundary
  const R2 = Math.max(0.65, Math.min(safeRadius * 0.78, R3 - minRadialSpacing)); // mid further out
  const R1 = Math.max(0.5,  Math.min(safeRadius * 0.58,  R2 - minRadialSpacing)); // inner, but we may drop it if too small

    const cap3 = capacityAt(R3);
    const cap2 = R2 > 0.29 ? capacityAt(R2) : 0;
    const cap1 = R1 > 0.24 ? capacityAt(R1) : 0;

    // Decide how many rings to use based on occupancy of each ring
    const lim = (cap, p=0.85) => Math.floor(cap * p);
  // Primary decision by group size to better utilize space; capacities act as guardrails
  let useRings = n >= 9 ? 3 : (n >= 5 ? 2 : 1);
  // If capacity is very tight, escalate ring count
  const oneOk  = n <= Math.floor(cap3 * 0.7);
  const twoOk  = n <= lim(cap3 + cap2, 0.82);
  if (useRings === 1 && !oneOk) { useRings = twoOk ? 2 : 3; }
  if (useRings === 2 && !twoOk) { useRings = 3; }

    // Perimeter weights for fair distribution
    const per3 = 2 * Math.PI * R3;
    const per2 = R2 > 0.4 ? 2 * Math.PI * R2 : 0;
    const per1 = R1 > 0.3 ? 2 * Math.PI * R1 : 0;

    let c1 = 0, c2 = 0, c3 = 0;
    if (useRings === 1) {
      // Everyone goes to the outer ring (comfortable occupancy already checked)
      c3 = n;
    } else if (useRings === 2) {
      const w3 = per3 * 1.25; // bias outer ring
      const w2 = per2 * 0.95;
      const totalW = Math.max(1e-6, w3 + w2);
      let t3 = Math.round(n * (w3 / totalW));
      let t2 = n - t3;
      // Clamp to occupancy limits
      t3 = Math.min(t3, lim(cap3));
      t2 = Math.min(t2, lim(cap2));
      // Fix rounding or clamp deficits
      let rem = n - (t3 + t2);
      // Greedy fill by headroom, prefer outer
      while (rem > 0 && (t3 < cap3 || t2 < cap2)) {
        if ((cap3 - t3) >= (cap2 - t2)) { t3++; } else { t2++; }
        rem--;
      }
      c3 = t3; c2 = t2;
    } else {
      // Bias weights to prefer outer, then mid, least inner
      const w3 = per3 * 1.3;
      const w2 = per2 * 1.0;
      const w1 = per1 * 0.75;
      const totalW = Math.max(1e-6, w3 + w2 + w1);
      let t3 = Math.round(n * (w3 / totalW));
      let t2 = Math.round(n * (w2 / totalW));
      let t1 = n - (t3 + t2);
      t3 = Math.min(t3, lim(cap3));
      t2 = Math.min(t2, lim(cap2));
      t1 = Math.min(t1, lim(cap1));
      let rem = n - (t1 + t2 + t3);
      while (rem > 0 && (t3 < cap3 || t2 < cap2 || t1 < cap1)) {
        // Prefer the ring with the most headroom (outer first on ties)
        const heads = [cap1 - t1, cap2 - t2, cap3 - t3];
        const idxBest = heads[2] >= heads[1] && heads[2] >= heads[0] ? 2 : (heads[1] >= heads[0] ? 1 : 0);
        if (idxBest === 2 && t3 < cap3) {
          t3++;
        } else if (idxBest === 1 && t2 < cap2) {
          t2++;
        } else if (t1 < cap1) {
          t1++;
        }
        rem--;
      }
      c1 = t1; c2 = t2; c3 = t3;
    }

    // If the inner or mid ring ended up too small, drop it and push its members outward
    if (useRings >= 3 && (R1 < 0.6 || cap1 < 2)) {
      const moved = c1; c1 = 0;
      // fill outer first, then mid
      let space3 = Math.max(0, lim(cap3) - c3);
      let add3 = Math.min(moved, space3); c3 += add3;
      let remAfter3 = moved - add3;
      if (remAfter3 > 0) {
        let space2 = Math.max(0, lim(cap2) - c2);
        let add2 = Math.min(remAfter3, space2); c2 += add2;
        remAfter3 -= add2;
      }
      // any remaining stays implicitly dropped (should be 0)
    }
    if (useRings >= 2 && (R2 < 0.7 || cap2 < 2)) {
      const moved = c2; c2 = 0;
      let space3 = Math.max(0, lim(cap3) - c3);
      let add3 = Math.min(moved, space3); c3 += add3;
      const remAfter3 = moved - add3;
      if (useRings >= 3 && remAfter3 > 0 && c1 < lim(cap1)) {
        c1 += Math.min(remAfter3, lim(cap1) - c1);
      }
    }

    const layers = [c1, c2, c3]; // inner -> mid -> outer counts
    const radii  = [R1, R2, R3];

    // Place agents with staggered offsets so no one sits on corner diagonals
    // Map circle coordinates to a rounded-square (FG-squircular) to better fill the square ring
    const diskToSquareFG = (u, v) => {
      // u,v in [-1,1] on unit circle; return x,z in [-1,1] on unit square
      const uu = Math.max(-1, Math.min(1, u));
      const vv = Math.max(-1, Math.min(1, v));
      const sx = uu * Math.sqrt(Math.max(0, 1 - (vv * vv) / 2));
      const sz = vv * Math.sqrt(Math.max(0, 1 - (uu * uu) / 2));
      return [sx, sz];
    };
    const positions = new Array(n);
    
    // Place the leading player at the center
    if (leadingPlayerIndex !== -1) {
      positions[leadingPlayerIndex] = [0, GROUND_Y, 0];
    }
    
    // Create a list of non-leading players to arrange around the center
  const nonLeadingIndices = [];
    for (let i = 0; i < n; i++) {
      if (i !== leadingPlayerIndex) {
        nonLeadingIndices.push(i);
      }
    }
    
    const remainingCount = nonLeadingIndices.length;
    if (remainingCount === 0) {
      return positions;
    }
    
    // Arrange remaining players using the same ring logic but adjusted for center occupation
    const adjustedN = remainingCount;
    
    // Recalculate ring distribution for remaining players
    let adjustedUseRings = adjustedN >= 8 ? 3 : (adjustedN >= 4 ? 2 : 1);
    const adjustedOneOk = adjustedN <= Math.floor(cap3 * 0.7);
    const adjustedTwoOk = adjustedN <= lim(cap3 + cap2, 0.82);
    if (adjustedUseRings === 1 && !adjustedOneOk) { adjustedUseRings = adjustedTwoOk ? 2 : 3; }
    if (adjustedUseRings === 2 && !adjustedTwoOk) { adjustedUseRings = 3; }

    let adjC1 = 0, adjC2 = 0, adjC3 = 0;
    if (adjustedUseRings === 1) {
      adjC3 = adjustedN;
    } else if (adjustedUseRings === 2) {
      const w3 = per3 * 1.25;
      const w2 = per2 * 0.95;
      const totalW = Math.max(1e-6, w3 + w2);
      let t3 = Math.round(adjustedN * (w3 / totalW));
      let t2 = adjustedN - t3;
      t3 = Math.min(t3, lim(cap3));
      t2 = Math.min(t2, lim(cap2));
      let rem = adjustedN - (t3 + t2);
      while (rem > 0 && (t3 < cap3 || t2 < cap2)) {
        if ((cap3 - t3) >= (cap2 - t2)) { t3++; } else { t2++; }
        rem--;
      }
      adjC3 = t3; adjC2 = t2;
    } else {
      const w3 = per3 * 1.3;
      const w2 = per2 * 1.0;
      const w1 = per1 * 0.75;
      const totalW = Math.max(1e-6, w3 + w2 + w1);
      let t3 = Math.round(adjustedN * (w3 / totalW));
      let t2 = Math.round(adjustedN * (w2 / totalW));
      let t1 = adjustedN - (t3 + t2);
      t3 = Math.min(t3, lim(cap3));
      t2 = Math.min(t2, lim(cap2));
      t1 = Math.min(t1, lim(cap1));
      let rem = adjustedN - (t1 + t2 + t3);
      while (rem > 0 && (t3 < cap3 || t2 < cap2 || t1 < cap1)) {
        const heads = [cap1 - t1, cap2 - t2, cap3 - t3];
        const idxBest = heads[2] >= heads[1] && heads[2] >= heads[0] ? 2 : (heads[1] >= heads[0] ? 1 : 0);
        if (idxBest === 2 && t3 < cap3) {
          t3++;
        } else if (idxBest === 1 && t2 < cap2) {
          t2++;
        } else if (t1 < cap1) {
          t1++;
        }
        rem--;
      }
      adjC1 = t1; adjC2 = t2; adjC3 = t3;
    }

    // Apply ring dropping logic
    if (adjustedUseRings >= 3 && (R1 < 0.6 || cap1 < 2)) {
      const moved = adjC1; adjC1 = 0;
      let space3 = Math.max(0, lim(cap3) - adjC3);
      let add3 = Math.min(moved, space3); adjC3 += add3;
      let remAfter3 = moved - add3;
      if (remAfter3 > 0) {
        let space2 = Math.max(0, lim(cap2) - adjC2);
        let add2 = Math.min(remAfter3, space2); adjC2 += add2;
        remAfter3 -= add2;
      }
    }
    if (adjustedUseRings >= 2 && (R2 < 0.7 || cap2 < 2)) {
      const moved = adjC2; adjC2 = 0;
      let space3 = Math.max(0, lim(cap3) - adjC3);
      let add3 = Math.min(moved, space3); adjC3 += add3;
      const remAfter3 = moved - add3;
      if (adjustedUseRings >= 3 && remAfter3 > 0 && adjC1 < lim(cap1)) {
        adjC1 += Math.min(remAfter3, lim(cap1) - adjC1);
      }
    }

    const adjustedLayers = [adjC1, adjC2, adjC3];
    
    let placementIdx = 0;
    for (let li = 0; li < adjustedLayers.length; li++) {
      const count = adjustedLayers[li];
      if (count <= 0) {
        continue;
      }
      let r = Math.max(0.2, radii[li]);
      const angleOffset = (li * Math.PI / 10) + (Math.PI / count) * 0.5 + (Math.PI / 14);
      for (let j = 0; j < count; j++, placementIdx++) {
        if (placementIdx >= nonLeadingIndices.length) {
          break;
        }
        
        const actualIndex = nonLeadingIndices[placementIdx];
        const jitter = (j % 2 === 0 ? 1 : -1) * (Math.PI / (count * 14));
        const a = angleOffset + (j / count) * (Math.PI * 2) + jitter;
        const rJ = Math.min(0.12, Math.max(0.06, minRadialSpacing * 0.12));
        const rr = Math.min(r + rJ, radii[li]);
        const u = Math.cos(a);
        const v = Math.sin(a);
        const [sx, sz] = diskToSquareFG(u, v);
        positions[actualIndex] = [sx * rr, GROUND_Y, sz * rr];
      }
    }
    
    // Safety: place any remaining non-leading players on outer ring
    while (placementIdx < nonLeadingIndices.length) {
      const actualIndex = nonLeadingIndices[placementIdx];
      const a = (placementIdx / nonLeadingIndices.length) * Math.PI * 2 + Math.PI / 12;
      positions[actualIndex] = [Math.cos(a) * Math.max(0.2, radii[2] || safeRadius * 0.9), GROUND_Y, Math.sin(a) * Math.max(0.2, radii[2] || safeRadius * 0.9)];
      placementIdx++;
    }
    // IMPORTANT: Apply dethroning swap BEFORE returning positions
    // This ensures the swap happens in the same frame as the leader change
    const prevLeader = prevLeaderRef.current;
    const hasLeaderChanged = (
      prevLeader !== null &&
      prevLeader !== undefined &&
      prevLeader !== -1 &&
      leadingPlayerIndex !== -1 &&
      leadingPlayerIndex !== prevLeader
    );
    
    if (hasLeaderChanged) {
      const newLeaderOldPos = lastPositionsRef.current?.[leadingPlayerIndex];
      if (newLeaderOldPos && Array.isArray(newLeaderOldPos) && newLeaderOldPos.length >= 3) {
        // Move dethroned leader to new leader's previous ring position
        positions[prevLeader] = [newLeaderOldPos[0], GROUND_Y, newLeaderOldPos[2]];
  if (DEBUG) { console.log(`[Dethroning] ${ring[prevLeader]?.name} moves to ${ring[leadingPlayerIndex]?.name}'s old position:`, newLeaderOldPos); }
      }
    }

    // --- Iterative overlap resolution and rope-bound clamping ---
    // Build a working copy of positions (x,y,z), guarding nulls
    const work = positions.map((p) => (p ? [...p] : [0, GROUND_Y, 0]));
  const nIters = 10; // small number of relaxation iterations
  const personalSpace = 0.08; // extra desired spacing beyond footprint sums
    const eps = 1e-4;
    // Define a conservative square boundary inside the ropes (half-extent on X/Z)
  const halfExtent = Math.max(0.5, (R3 || safeRadius) * 0.992);
    // Quick helper to clamp one agent to the square boundary while considering its footprint radius
    const clampToRing = (i) => {
      const r = Math.max(0.15, footprintRadii[i] ?? 0.35);
      // keep entire footprint inside ropes
      work[i][0] = Math.max(-halfExtent + r, Math.min(halfExtent - r, work[i][0]));
      work[i][2] = Math.max(-halfExtent + r, Math.min(halfExtent - r, work[i][2]));
      // keep Y on ground
      work[i][1] = GROUND_Y;
    };
    // Initialize with a clamp pass
    for (let i = 0; i < n; i++) clampToRing(i);
    // Relax overlaps; pin the current leader at center for stability
    const pinned = new Set();
  if (leadingPlayerIndex !== -1) { pinned.add(leadingPlayerIndex); }
    for (let iter = 0; iter < nIters; iter++) {
      // Pairwise push apart
      for (let i = 0; i < n; i++) {
        const pi = work[i];
        const ri = Math.max(0.15, footprintRadii[i] ?? 0.35);
        for (let j = i + 1; j < n; j++) {
          const pj = work[j];
          const rj = Math.max(0.15, footprintRadii[j] ?? 0.35);
          const dx = pj[0] - pi[0];
          const dz = pj[2] - pi[2];
          let d2 = dx * dx + dz * dz;
          const minDist = ri + rj + personalSpace + 0.02; // add personal space + small buffer
          if (d2 <= eps) {
            // Perfect overlap: nudge randomly before normalizing
            const angle = (i * 1327 + j * 9151 + iter * 73) % 6283 / 1000; // pseudo-random but stable
            const jx = Math.cos(angle) * 0.002;
            const jz = Math.sin(angle) * 0.002;
            pj[0] += jx; pj[2] += jz; pi[0] -= jx; pi[2] -= jz;
            d2 = (pj[0] - pi[0]) ** 2 + (pj[2] - pi[2]) ** 2;
          }
          const d = Math.sqrt(Math.max(eps, d2));
          if (d < minDist) {
            const overlap = minDist - d;
            const nx = (pj[0] - pi[0]) / d;
            const nz = (pj[2] - pi[2]) / d;
            // Move both unless pinned; weight by whether pinned
            const moveI = pinned.has(i) ? 0 : 0.5;
            const moveJ = pinned.has(j) ? 0 : 0.5;
            const denom = Math.max(eps, moveI + moveJ);
            const sI = (overlap * moveI) / denom;
            const sJ = (overlap * moveJ) / denom;
            pi[0] -= nx * sI; pi[2] -= nz * sI;
            pj[0] += nx * sJ; pj[2] += nz * sJ;
            // Clamp back to ring
            clampToRing(i);
            clampToRing(j);
          }
        }
      }
      // One extra clamp pass per iteration to resolve boundary drift
      for (let i = 0; i < n; i++) clampToRing(i);
    }

    // Gentle visual smoothing to reduce popping on big corrections
    const last = lastPositionsRef.current || [];
    for (let i = 0; i < n; i++) {
      const prev = last[i];
      if (prev && Array.isArray(prev)) {
        const alpha = 0.7; // blend toward new target; higher=snappier
        work[i][0] = prev[0] + (work[i][0] - prev[0]) * alpha;
        work[i][2] = prev[2] + (work[i][2] - prev[2]) * alpha;
        work[i][1] = GROUND_Y;
      }
    }

    return work;
  }, [ring, boundsByIndex, leaderIndex, footprintRadii]);

  // After computing positions, remember them for the next frame and update previous leader
  useEffect(() => {
    if (Array.isArray(agentPositions)) {
      // Update position tracking FIRST, before logging
      lastPositionsRef.current = agentPositions.map(p => (p ? [...p] : p));
    }
    
    // Then check for leader changes and log
    const prevLeader = prevLeaderRef.current;
    const newLeader = leaderIndex;
    if (
      prevLeader !== null && prevLeader !== undefined && prevLeader !== -1 &&
      newLeader !== null && newLeader !== undefined && newLeader !== -1 &&
      prevLeader !== newLeader
    ) {
      const prevLeaderName = ring[prevLeader]?.name;
      const newLeaderName = ring[newLeader]?.name;
      try {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.groupCollapsed('[LeaderChange]');
          // eslint-disable-next-line no-console
          console.log('from', { index: prevLeader, name: prevLeaderName });
          // eslint-disable-next-line no-console
          console.log('to', { index: newLeader, name: newLeaderName });
          // eslint-disable-next-line no-console
          console.groupEnd();
        }
      } catch {}
    }
    
    // Finally update the previous leader reference
    prevLeaderRef.current = leaderIndex;
  }, [agentPositions, leaderIndex, ring]);
  
  // Memoize the camera configuration
  const cameraConfig = useMemo(() => ({
    position: [0, 5, 8],
    fov: 50,
  }), []);
  
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={cameraConfig}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance"
        }}
        dpr={[0.75, 1.25]} // Lower DPR range for weaker GPUs
        performance={{ min: 0.4 }} // Allow adaptive detail reduction
      >
        <Suspense fallback={null}>
          {/* HDRI background (toggleable) + reflections; blur softens background */}
          <Environment preset={envPreset} background={envBackground} intensity={envIntensity} blur={0.2} />
          {/* Lighting */}
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[768, 768]}
            shadow-camera-near={0.1}
            shadow-camera-far={50}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
          />
          <hemisphereLight intensity={0.3} groundColor="#404040" />
          <pointLight position={[-5, 3, -5]} intensity={0.4} color="#ffffff" />
          
          {/* Boxing Ring Floor scaled to player height */}
          <BoxingRing desiredRadius={DESIRED_RADIUS} groundY={GROUND_Y} averageHeight={averageHeight} />

          {/* Physics stepper updates simPositions each frame for gentle push-apart */}
          <PhysicsStepper
            targetPositions={agentPositions}
            radii={footprintRadii}
            groundY={GROUND_Y}
            averageHeight={averageHeight}
            desiredRadius={DESIRED_RADIUS}
            leaderIndex={leaderIndex}
            setPositions={setSimPositions}
          />

          {/* Collision debug overlay (press 'c' to toggle) */}
          {debugCollisions && (
            <CollisionDebugger positions={simPositions} radii={footprintRadii} groundY={GROUND_Y} verbose={true} />
          )}

          {/* Center marker (press 'm' to toggle) */}
          {showCenterMarker && (
            <mesh position={[0, GROUND_Y + 0.02, 0]}>
              <ringGeometry args={[0.15, 0.2, 48]} />
              <meshBasicMaterial color="#FFD700" transparent opacity={0.8} depthWrite={false} />
            </mesh>
          )}
          
          {/* Agents - memoized to prevent unnecessary re-renders */}
  {ring.map((agent, index) => {
    const position = simPositions[index] || agentPositions[index] || [0, GROUND_Y, 0];
            const isInteracting = interaction && 
              (interaction.A === agent.name || interaction.B === agent.name);
            
            // Determine if this agent is the current leader
            const isLeader = leaderIndex === index;
            
            // Compute opponent position if this agent is currently interacting
            let lookAtTarget = undefined;
            if (isInteracting && interaction) {
              const opponentName = interaction.A === agent.name ? interaction.B : interaction.A;
              const opponentIndex = ring.findIndex(a => a.name === opponentName);
              if (opponentIndex !== -1) {
                lookAtTarget = agentPositions[opponentIndex];
              }
            }
            // Determine this agent's current action and a stable key for pulse triggering
            let action = undefined;
            let interactionKey = undefined;
            if (isInteracting && interaction) {
              action = interaction.A === agent.name ? interaction.aMove : interaction.bMove;
              interactionKey = `${interaction.A}|${interaction.B}|${interaction.aMove}|${interaction.bMove}|${interaction.pA}|${interaction.pB}`;
            }
            
            return (
              <group
                key={`agent-group-${index}`}
                ref={(el) => { agentGroupRefs.current[index] = el || null; }}
                userData={{ agentIndex: index }}
              >
        <Agent
                  key={`${agent.name}-${agent.isClassic}`} // Stable key
                  name={agent.name}
                  position={position}
                  isClassic={agent.isClassic}
                  isInteracting={isInteracting}
          isLeader={isLeader}
          onClick={onAgentClick}
          index={index}
          onBoundsComputed={handleBoundsComputed}
          lookAtTarget={lookAtTarget}
          action={action}
      interactionKey={interactionKey}
      hitRadius={Math.max(0.25, (boundsByIndex[index]?.width ?? 0.6) * 0.35)}
      hitHeight={Math.max(1.0, (boundsByIndex[index]?.height ?? 1.6) * 0.9)}
                />
                {/* Focused nameplate above head (hidden when overlays are disabled) */}
                {focusedIndex === index && !hideOverlays && (
                  <FocusNameplate
                    position={position}
                    height={boundsByIndex[index]?.height || 1.6}
                    label={agent.name}
                  />
                )}
                {showScoreLabels && (
                  <Html position={[position[0], position[1] + 2.6, position[2]]} center style={{ pointerEvents: 'none' }}>
                    <div style={{
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      border: isLeader ? '1px solid #FFD700' : '1px solid rgba(255,255,255,0.15)'
                    }}>
                      {agent.name}: {getAgentScore(agent)}
                    </div>
                  </Html>
                )}
                {/* Leader crown effect */}
                {isLeader && (
                  <Crown3D 
                    position={position} 
                    averageHeight={averageHeight} 
                    agentBounds={boundsByIndex[index]} 
                  />
                )}
              </group>
            );
          })}
          
          {/* Cinematic Camera Controller */}
          <CinematicCamera
            agentPositions={agentPositions}
            ring={ring}
            boundsByIndex={boundsByIndex}
            agentRefs={agentGroupRefs}
            onFocusChange={setFocusedIndex}
          />
        </Suspense>
      </Canvas>
      {/* Leader Debug HUD (press 'l' to toggle) */}
      {showLeaderDebug && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, maxWidth: 360 }}>
          <div style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12 }}>
            <div style={{ marginBottom: 6, opacity: 0.9 }}>
              Leader Debug • l: HUD • v: labels • m: center • c: collisions
            </div>
            {(() => {
              const rows = ring.map((a, i) => ({ i, name: a?.name, score: getAgentScore(a), pos: agentPositions?.[i] })).sort((a, b) => b.score - a.score);
              return (
                <div>
                  {rows.map(r => (
                    <div key={r.i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                      <span style={{ width: 18, color: r.i === leaderIndex ? '#FFD700' : '#aaa' }}>{r.i}</span>
                      <span style={{ flex: 1, color: r.i === leaderIndex ? '#FFD700' : '#fff' }}>{r.name}</span>
                      <span style={{ width: 60, textAlign: 'right' }}>{r.score}</span>
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>{r.pos ? `(${r.pos[0].toFixed(2)}, ${r.pos[2].toFixed(2)})` : '(none)'}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// Lightweight per-frame physics that keeps agents inside the ropes and pushes overlaps apart
function PhysicsStepper({
  targetPositions = [],
  radii = [],
  groundY = -2.0,
  averageHeight = 1.6,
  desiredRadius = 3,
  leaderIndex = -1,
  setPositions,
}) {
  const simRef = useRef([]);
  const lastLenRef = useRef(0);
  const personalSpace = 0.06; // extra spacing beyond footprint sums

  // Derive a conservative square boundary half-extent, consistent with ring placement
  const halfExtent = useMemo(() => {
    const ropeMargin = Math.max(0.4, averageHeight * 0.30);
    const safeRadius = Math.max(1.6, desiredRadius - ropeMargin);
    return Math.max(0.5, safeRadius * 0.992);
  }, [averageHeight, desiredRadius]);

  // Ensure sim buffer is aligned with targets
  useEffect(() => {
    const n = targetPositions.length;
    if (lastLenRef.current !== n) {
      simRef.current = targetPositions.map(p => (p ? [...p] : [0, groundY, 0]));
      lastLenRef.current = n;
      setPositions(simRef.current.map(p => [...p]));
    }
  }, [targetPositions, groundY, setPositions]);

  useFrame((_, delta) => {
    const sim = simRef.current;
    const n = Math.min(sim.length, targetPositions.length);
  if (!n) { return; }

    // 1) Softly follow target positions
    const follow = Math.min(1, 8 * delta); // stiffness toward layout
    for (let i = 0; i < n; i++) {
      const t = targetPositions[i] || [0, groundY, 0];
      const p = sim[i] || (sim[i] = [0, groundY, 0]);
      p[0] += (t[0] - p[0]) * follow;
      p[2] += (t[2] - p[2]) * follow;
      p[1] = groundY;
    }

    // 2) Resolve overlaps iteratively (few passes are enough)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const pi = sim[i];
        const ri = Math.max(0.15, radii[i] ?? 0.35);
        for (let j = i + 1; j < n; j++) {
          const pj = sim[j];
          const rj = Math.max(0.15, radii[j] ?? 0.35);
          const dx = pj[0] - pi[0];
          const dz = pj[2] - pi[2];
          const d2 = dx * dx + dz * dz;
          const minDist = ri + rj + personalSpace;
          if (d2 < minDist * minDist) {
            const d = Math.max(1e-5, Math.sqrt(d2));
            const nx = dx / d;
            const nz = dz / d;
            const overlap = minDist - d;
            // Pin leader at center; others move around them
            const moveI = i === leaderIndex ? 0 : 0.5;
            const moveJ = j === leaderIndex ? 0 : 0.5;
            const denom = Math.max(1e-5, moveI + moveJ);
            const sI = (overlap * moveI) / denom;
            const sJ = (overlap * moveJ) / denom;
            pi[0] -= nx * sI; pi[2] -= nz * sI;
            pj[0] += nx * sJ; pj[2] += nz * sJ;
          }
        }
      }
      // Clamp to ring boundary after each pass
      for (let i = 0; i < n; i++) {
        const r = Math.max(0.15, radii[i] ?? 0.35);
        sim[i][0] = Math.max(-halfExtent + r, Math.min(halfExtent - r, sim[i][0]));
        sim[i][2] = Math.max(-halfExtent + r, Math.min(halfExtent - r, sim[i][2]));
        sim[i][1] = groundY;
      }
    }

    // 3) Push updates to React so Agents receive new positions
    setPositions(sim.map(p => [...p]));
  });

  return null;
}