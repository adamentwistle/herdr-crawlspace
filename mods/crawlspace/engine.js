// The ray caster. No app calls here, so tests can run it. A map is an array of rows of one-character tiles.
export const FOV = 0.66;
const DOORS = "Drb";
const PASS = ".";

export const isDoor = (tile) => DOORS.includes(tile);
export const tileAt = (map, x, y) => map[Math.floor(y)]?.[Math.floor(x)] ?? "#";
export const doorKey = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;

export function solid(map, doors, x, y) {
  const tile = tileAt(map, x, y);
  if (tile === PASS) return false;
  if (isDoor(tile)) return (doors[doorKey(x, y)] ?? 0) < 0.9;
  return true;
}

// One ray from (px, py) along (dx, dy). Gives the distance along the view, the tile, where on the tile (0 to 1) and which face.
export function cast(map, doors, px, py, dx, dy) {
  let mx = Math.floor(px), my = Math.floor(py);
  const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
  const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx), ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
  let sx = (dx < 0 ? px - mx : mx + 1 - px) * ddx, sy = (dy < 0 ? py - my : my + 1 - py) * ddy;
  for (let i = 0; i < 64; i++) {
    let side;
    if (sx < sy) { sx += ddx; mx += stepX; side = 0; } else { sy += ddy; my += stepY; side = 1; }
    const tile = map[my]?.[mx] ?? "#";
    if (tile === PASS) continue;
    const dist = side === 0 ? sx - ddx : sy - ddy;
    let u = side === 0 ? py + dist * dy : px + dist * dx;
    u -= Math.floor(u);
    if (isDoor(tile)) {
      const open = doors[`${mx},${my}`] ?? 0;
      if (u < open) continue;
      u -= open;
    }
    if ((side === 0 && dx > 0) || (side === 1 && dy < 0)) u = 1 - u;
    return { dist: Math.max(dist, 0.01), tile, u, side };
  }
  return { dist: 64, tile: "#", u: 0, side: 0 };
}

// Every column of the view.
export function castView(map, doors, player, cols) {
  const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
  const planeX = -dirY * FOV, planeY = dirX * FOV;
  const out = new Array(cols);
  for (let i = 0; i < cols; i++) {
    const c = (2 * (i + 0.5)) / cols - 1;
    out[i] = cast(map, doors, player.x, player.y, dirX + planeX * c, dirY + planeY * c);
  }
  return out;
}

// Where a thing at (x, y) lands: `depth` along the view, `screen` from -1 (left edge) to 1 (right edge). Null when behind.
export function project(player, x, y) {
  const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
  const planeX = -dirY * FOV, planeY = dirX * FOV;
  const rx = x - player.x, ry = y - player.y;
  const inv = 1 / (planeX * dirY - dirX * planeY);
  const side = inv * (dirY * rx - dirX * ry);
  const depth = inv * (-planeY * rx + planeX * ry);
  if (depth <= 0.05) return null;
  return { depth, screen: side / depth };
}

export function canSee(map, doors, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 0.01) return true;
  return cast(map, doors, ax, ay, dx / len, dy / len).dist >= len - 0.05;
}
