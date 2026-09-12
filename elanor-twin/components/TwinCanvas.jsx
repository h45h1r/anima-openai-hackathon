"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Vector3 } from "three";

const nodePositions = {
  activity: [0, 0.15, 0.88],
  blood: [0, 1.1, 0.75],
  metabolic: [-0.4, 0.48, 0.82],
  liver: [0.42, 0.42, 0.82],
  mobility: [0, -0.95, 0.74],
  care: [0.75, -0.1, 0.62],
};

const severityColours = {
  high: "#C2572F",
  moderate: "#C98A1E",
  within: "#2F6B4F",
};

const cameraFocus = {
  activity: { position: [0, 0.1, 4.3], target: [0, 0.05, 0] },
  blood: { position: [0, 1.12, 3.45], target: [0, 1.08, 0] },
  metabolic: { position: [-0.7, 0.48, 3.25], target: [-0.35, 0.45, 0] },
  liver: { position: [0.72, 0.44, 3.25], target: [0.4, 0.4, 0] },
  mobility: { position: [0, -0.92, 3.55], target: [0, -0.92, 0] },
  care: { position: [0.82, -0.08, 3.5], target: [0.64, -0.08, 0] },
};

function SomaBody({ gender }) {
  const source = useLoader(OBJLoader, "/models/soma-x-base-body.obj");
  const profile = gender === "female"
    ? { scale: [1.9, 2.08, 2.1], colour: "#6d4c73" }
    : { scale: [2.1, 2.08, 2.1], colour: "#456a78" };
  const body = useMemo(() => {
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = new child.material.constructor({
          color: profile.colour,
          emissive: "#ffffff",
          emissiveIntensity: 0.04,
          metalness: 0.12,
          roughness: 0.55,
          transparent: true,
          opacity: 0.72,
        });
      }
    });
    return clone;
  }, [source, profile.colour]);

  return (
    <primitive object={body} position={[0, 0.05, 0]} scale={profile.scale} />
  );
}

function SignalNode({ id, color, selected, onPick }) {
  const [hovered, setHovered] = useState(false);
  const position = nodePositions[id];
  return (
    <group position={position}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onPick(id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[selected || hovered ? 0.14 : 0.1, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected || hovered ? 3 : 1.5} />
      </mesh>
      <mesh scale={selected ? [2.1, 2.1, 2.1] : [1.6, 1.6, 1.6]}>
        <sphereGeometry args={[0.1, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.25 : 0.1} />
      </mesh>
    </group>
  );
}

function CameraDirector({ selected, focusVersion }) {
  const controls = useRef();
  const { camera } = useThree();
  const targetPosition = useMemo(() => new Vector3(), []);
  const targetLookAt = useMemo(() => new Vector3(), []);
  const isMoving = useRef(true);

  useEffect(() => {
    const focus = cameraFocus[selected] ?? cameraFocus.activity;
    targetPosition.set(...focus.position);
    targetLookAt.set(...focus.target);
    isMoving.current = true;
  }, [focusVersion, selected, targetLookAt, targetPosition]);

  useFrame(() => {
    if (!isMoving.current) return;
    camera.position.lerp(targetPosition, 0.1);
    controls.current?.target.lerp(targetLookAt, 0.1);
    controls.current?.update();
    if (camera.position.distanceTo(targetPosition) < 0.015 && controls.current?.target.distanceTo(targetLookAt) < 0.015) {
      isMoving.current = false;
    }
  });

  return <OrbitControls ref={controls} enablePan={false} minDistance={2.8} maxDistance={6.5} />;
}

function Figure({ selected, onPick, gender, signalSeverities, focusVersion }) {
  const signals = useMemo(
    () => Object.keys(nodePositions).map((id) => [id, severityColours[signalSeverities[id]] ?? severityColours.moderate]),
    [signalSeverities],
  );

  return (
    <>
      <ambientLight intensity={2.8} />
      <pointLight position={[3, 3, 4]} intensity={11} color="#ffffff" />
      <pointLight position={[-3, 0, 3]} intensity={4} color="#f1e4ec" />
      <SomaBody gender={gender} />
      <mesh position={[0, -1.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 64]} />
        <meshBasicMaterial color="#2F6B4F" transparent opacity={0.1} />
      </mesh>
      {signals.map(([id, color]) => (
        <SignalNode key={id} id={id} color={color} selected={id === selected} onPick={onPick} />
      ))}
      <CameraDirector selected={selected} focusVersion={focusVersion} />
    </>
  );
}

export default function TwinCanvas({ selected, onPick, gender, signalSeverities, focusVersion }) {
  return (
    <Canvas camera={{ position: [0, 0.1, 5.2], fov: 42 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#F2F4F1"]} />
      <Figure selected={selected} onPick={onPick} gender={gender} signalSeverities={signalSeverities} focusVersion={focusVersion} />
    </Canvas>
  );
}
