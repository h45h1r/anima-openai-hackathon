import type { Metadata } from "next";
import NhsDemo from "./NhsDemo";

export const metadata: Metadata = {
  title: "Kindred × NHS App — a family care demo",
  description:
    "An isolated hackathon demo with fictional records and simulated NHS integrations.",
};

export default function Page() {
  return <NhsDemo />;
}
