import { Quaternion, Vector3 } from "three";

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export function vecToTuple(v: Vector3): Vec3Tuple {
  return [v.x, v.y, v.z];
}

export function tupleToVec3(t: Vec3Tuple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

export function quatToTuple(q: Quaternion): QuatTuple {
  return [q.x, q.y, q.z, q.w];
}

export function tupleToQuat(t: QuatTuple): Quaternion {
  return new Quaternion(t[0], t[1], t[2], t[3]);
}
