const workspace = document.getElementById("workspace");
const gears = [];
const BASE_SPEED = 1.5;
const BASE_RPM = 60;
const BASE_TORQUE = 1;
let topZ = 1;

// ---------- SVG GEAR ----------
function gearSVG(teeth, size) {
    const r = size / 2;
    const depth = r * 0.25;
    const step = (Math.PI * 2) / teeth;

    let d = "";
    for (let i = 0; i < teeth; i++) {
        const a = i * step;
        const a2 = a + step / 2;
        const r1 = r - depth;
        const r2 = r;

        const x1 = r + r1 * Math.cos(a);
        const y1 = r + r1 * Math.sin(a);
        const x2 = r + r2 * Math.cos(a2);
        const y2 = r + r2 * Math.sin(a2);

        d += `${i === 0 ? "M" : "L"}${x1},${y1} L${x2},${y2} `;
    }
    d += "Z";

    return `<svg width="${size}" height="${size}">
        <path d="${d}" fill="#7e7e7eff"/>
        <circle cx="${r}" cy="${r}" r="${r*0.35}" fill="#1b1b1b"/>
    </svg>`;
}

// ---------- GEAR CLASS ----------
class Gear {
    constructor(teeth, x, y, motor = false) {
        this.teeth = teeth;
        this.size = teeth * 14;
        this.radius = this.size / 2;
        this.angle = 0;
        this.speed = motor ? BASE_SPEED : 0;
        this.level = 1;
        this.shaftParent = null;
        this.connected = [];
        this.children = []; // ✅ FIX: initialize children array

        this.el = document.createElement("div");
        this.el.className = "gear";
        if (motor) this.el.classList.add("motor");

        this.el.style.left = x + "px";
        this.el.style.top = y + "px";
        this.el.style.width = this.size + "px";
        this.el.style.height = this.size + "px";
        this.el.innerHTML = `
            ${gearSVG(teeth, this.size)}
            <div class="gear-ui">
                <div class="stats">
                 <div class="rpm">RPM: 0</div>
                    <div class="torque">TQ: 0</div>
              </div>
              <div class="level-controls">
                 <button class="up">▲</button>
                   <button class="down">▼</button>
              </div>
         </div>
        `;

        workspace.appendChild(this.el);
        gears.push(this);
        this.drag();
    }

    drag() {
        let ox, oy;

        this.el.onmousedown = e => {
    ox = e.offsetX;
    oy = e.offsetY;

    // ✅ Bring to front
    this.el.style.zIndex = ++topZ;

        document.onmousemove = ev => {
            this.el.style.left = ev.pageX - workspace.offsetLeft - ox + "px";
            this.el.style.top  = ev.pageY - workspace.offsetTop - oy + "px";
            snapToMesh(this);
            checkStack(this);
            checkConnections();
        };

     document.onmouseup = () => {
            document.onmousemove = null;
            checkStack(this, true);
            checkConnections();
            checkTrash(this);
        };
    };
    }

    rotate() {
        this.angle += this.speed;
        this.el.style.transform = `rotate(${this.angle}deg)`;
    }

    get center() {
        return {
            x: this.el.offsetLeft + this.radius,
            y: this.el.offsetTop + this.radius
        };
    }
}

// ---------- STACKING (LEVEL 2) ----------
function checkStack(g, onDrop = false) {
    if (!onDrop) return;

    // Try to stack
    for (const other of gears) {
        if (
            other !== g &&
            other.level === 1 &&
            !other.el.classList.contains("motor")
        ) {
            const dx = g.center.x - other.center.x;
            const dy = g.center.y - other.center.y;
            const dist = Math.hypot(dx, dy);

            if (dist < other.radius * 0.35) {
                // HARD LOCK
                g.level = 2;
                g.shaftParent = other;
                other.children.push(g);

                // Snap to exact center
                g.el.style.left =
                    (other.center.x - g.radius) + "px";
                g.el.style.top =
                    (other.center.y - g.radius) + "px";

                g.el.classList.add("level-2");
                return;
            }
        }
    }

    // Unstack
    if (g.level === 2) {
        const p = g.shaftParent;
        if (p) {
            p.children = p.children.filter(c => c !== g);
        }
        g.level = 1;
        g.shaftParent = null;
        g.el.classList.remove("level-2");
    }
}

// ---------- CONNECTIONS ----------
function checkConnections() {
    gears.forEach(g => g.connected = []);

    for (let i = 0; i < gears.length; i++) {
        for (let j = i + 1; j < gears.length; j++) {
            const a = gears[i];
            const b = gears[j];

            if (a.level !== b.level) return;

            const d = Math.hypot(
                a.center.x - b.center.x,
                a.center.y - b.center.y
            );

            if (Math.abs(d - (a.radius + b.radius)) < 6) {
                a.connected.push(b);
                b.connected.push(a);
            }
        }
    }
    propagate();
}

function snapToMesh(g) {
    for (const other of gears) {
        if (other === g) continue;
        if (other.level !== g.level) continue;

        const dx = g.center.x - other.center.x;
        const dy = g.center.y - other.center.y;
        const dist = Math.hypot(dx, dy);

        const target = g.radius + other.radius;
        const snapRange = 12;

        if (Math.abs(dist - target) < snapRange) {
            const angle = Math.atan2(dy, dx);

            const nx = other.center.x + Math.cos(angle) * target;
            const ny = other.center.y + Math.sin(angle) * target;

            g.el.style.left = (nx - g.radius) + "px";
            g.el.style.top  = (ny - g.radius) + "px";

            return;
        }
    }
}


// ---------- ROTATION ----------
function propagate() {
    // Reset speeds
    gears.forEach(g => {
        if (!g.el.classList.contains("motor")) g.speed = 0;
    });

    const queue = gears.filter(g => g.speed !== 0);
    const visited = new Set();

    while (queue.length) {
        const g = queue.shift();
        if (visited.has(g)) continue;
        visited.add(g);

        // SHAFT COUPLING (ALWAYS)
        if (g.children.length) {
            g.children.forEach(c => {
                c.speed = g.speed;
                queue.push(c);
            });
        }

        if (g.shaftParent && g.speed === 0) {
            g.speed = g.shaftParent.speed;
            queue.push(g);
        }

        // MESHING (same level only)
        g.connected.forEach(o => {
            if (o.speed === 0) {
                o.speed = -g.speed * (g.teeth / o.teeth);
                queue.push(o);
            }
        });
    }
}

// ---------- TRASH ----------
function checkTrash(g) {
    const trash = document.getElementById("trash").getBoundingClientRect();
    const rect = g.el.getBoundingClientRect();

    if (rect.left < trash.right &&
        rect.right > trash.left &&
        rect.top < trash.bottom &&
        rect.bottom > trash.top) {

        g.el.remove();
        gears.splice(gears.indexOf(g), 1);
    }
}

// ---------- TRAY ----------
document.querySelectorAll(".tray-gear").forEach(t => {
    t.onmousedown = e => {
        new Gear(+t.dataset.teeth, 300, 200);
    };
});

document.getElementById("addCustomGear").onclick = () => {
    const teeth = parseInt(document.getElementById("customTeeth").value);

    if (isNaN(teeth) || teeth < 3) return;

    new Gear(teeth, 300, 200);
};

// ---------- MOTOR ----------
new Gear(8, 200, 200, true);

// ---------- LOOP ----------
function animate() {
    gears.forEach(g => g.rotate());
    requestAnimationFrame(animate);
}
animate();