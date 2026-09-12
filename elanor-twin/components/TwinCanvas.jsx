"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo, useState } from "react";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

const nodePositions = {
  activity: [0, 0.15, 0.88],
  blood: [0, 1.1, 0.75],
  metabolic: [-0.4, 0.48, 0.82],
  liver: [0.42, 0.42, 0.82],
  mobility: [0, -0.95, 0.74],
  care: [0.75, -0.1, 0.62],
};

function SomaBody() {
  const source = useLoader(OBJLoader, "/models/soma-x-base-body.obj");
  const body = useMemo(() => {
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = new child.material.constructor({
          color: "#506fca",
          emissive: "#1f4eaa",
          emissiveIntensity: 0.12,
          metalness: 0.12,
          roughness: 0.55,
          transparent: true,
          opacity: 0.72,
        });
      }
    });
    return clone;
  }, [source]);

  return (
    <primitive object={body} position={[0, 0.05, 0]} scale={[2.1, 2.1, 2.1]} />
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

function Figure({ selected, onPick }) {
  const signals = useMemo(
    () => [
      ["activity", "#ffb84e"],
      ["blood", "#ff5f7e"],
      ["metabolic", "#ff5f7e"],
      ["liver", "#ffb84e"],
      ["mobility", "#ffb84e"],
      ["care", "#8f7cff"],
    ],
    [],
  );

  return (
    <>
      <ambientLight intensity={2.4} />
      <pointLight position={[3, 3, 4]} intensity={13} color="#c7d8ff" />
      <pointLight position={[-3, 0, 3]} intensity={5} color="#ffd3dc" />
      <SomaBody />
      <mesh position={[0, -1.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 64]} />
        <meshBasicMaterial color="#5277db" transparent opacity={0.1} />
      </mesh>
      {signals.map(([id, color]) => (
        <SignalNode key={id} id={id} color={color} selected={id === selected} onPick={onPick} />
      ))}
      <OrbitControls enablePan={false} minDistance={4.3} maxDistance={6.5} />
    </>
  );
}

export default function TwinCanvas({ selected, onPick }) {
  return (
    <Canvas camera={{ position: [0, 0.1, 5.2], fov: 42 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#eff4fb"]} />
      <Figure selected={selected} onPick={onPick} />
    </Canvas>
  );
}
