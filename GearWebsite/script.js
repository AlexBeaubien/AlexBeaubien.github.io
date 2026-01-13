const workspace = document.getElementById("workspace");
const gears = [];

const BASE_RPM = 60;
const BASE_TORQUE = 1;
const BASE_SPEED = 360 * (BASE_RPM / 60); // deg/sec
let topZ = 1;

// ---------- SVG ----------
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

        d += `${i === 0 ? "M" : "L"}${r + r1 * Math.cos(a)},${r + r1 * Math.sin(a)} `;
        d += `L${r + r2 * Math.cos(a2)},${r + r2 * Math.sin(a2)} `;
    }
    d += "Z";

    return `
    <svg width="${size}" height="${size}">
        <path d="${d}" fill="#7e7e7eff"/>
        <circle cx="${r}" cy="${r}" r="${r * 0.35}" fill="#1b1b1b"/>
    </svg>`;
}

// ---------- GEAR ----------
class Gear {
    constructor(teeth, x, y, motor = false) {
        this.teeth = teeth;
        this.size = teeth * 14;
        this.radius = this.size / 2;

        this.angle = 0;
        this.speed = motor ? BASE_SPEED : 0;
        this.rpm = motor ? BASE_RPM : 0;
        this.torque = motor ? BASE_TORQUE : 0;

        this.level = 1;
        this.shaftParent = null;
        this.children = [];
        this.connected = [];

        this.el = document.createElement("div");
        this.el.className = "gear";
        if (motor) this.el.classList.add("motor");

        this.el.style.left = x + "px";
        this.el.style.top = y + "px";
        this.el.style.width = this.size + "px";
        this.el.style.height = this.size + "px";
        this.el.style.zIndex = ++topZ;
        updateZOrder();

        this.el.innerHTML = `
        <div class="gear-rotator">
         ${gearSVG(teeth, this.size)}
        </div>

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

        this.enableDrag();
        this.bindUI();
    }

    get center() {
        return {
            x: this.el.offsetLeft + this.radius,
            y: this.el.offsetTop + this.radius
        };
    }

    enableDrag() {
    let ox, oy;

    this.el.onmousedown = e => {
        if (e.target.closest(".gear-ui")) return;

        // If clicking a level-2 gear, drag its parent instead
        const dragGear = this.level === 2 ? this.shaftParent : this;
        if (!dragGear) return;

        ox = e.pageX - dragGear.el.offsetLeft - workspace.offsetLeft;
        oy = e.pageY - dragGear.el.offsetTop - workspace.offsetTop;

        dragGear.el.style.zIndex = ++topZ;
        updateZOrder();

        document.onmousemove = ev => {
            const nx = ev.pageX - workspace.offsetLeft - ox;
            const ny = ev.pageY - workspace.offsetTop - oy;

            const dx = nx - dragGear.el.offsetLeft;
            const dy = ny - dragGear.el.offsetTop;

            dragGear.el.style.left = nx + "px";
            dragGear.el.style.top  = ny + "px";

            // Move stacked children with parent
            dragGear.children.forEach(c => {
                c.el.style.left = c.el.offsetLeft + dx + "px";
                c.el.style.top  = c.el.offsetTop + dy + "px";
            });

            snapToMesh(dragGear);
            enforceShaftAlignment();
            checkConnections();
        };

        document.onmouseup = () => {
            document.onmousemove = null;
            document.onmouseup = null;
            checkConnections();
            checkTrash(dragGear);
        };
    };
}

    bindUI() {
        this.el.querySelector(".up").onclick = () => stackGear(this);
        this.el.querySelector(".down").onclick = () => unstackGear(this);
    }

    rotate(dt) {
        this.angle += this.speed * dt;
        const rotator = this.el.querySelector(".gear-rotator");
        rotator.style.transform = `rotate(${this.angle}deg)`;

        this.el.querySelector(".rpm").textContent =
            "RPM: " + this.rpm.toFixed(1);

        this.el.querySelector(".torque").textContent =
            "TQ: " + this.torque.toFixed(2);
    }
}

// ---------- STACKING ----------
function stackGear(g) {
    if (g.level === 2) return;

    let closest = null;
    let minDist = Infinity;

    for (const other of gears) {
        if (
            other !== g &&
            other.level === 1 &&
            !other.el.classList.contains("motor")
        ) {
            const d = Math.hypot(
                g.center.x - other.center.x,
                g.center.y - other.center.y
            );

            if (d < other.radius * 0.8 && d < minDist) {
                minDist = d;
                closest = other;
            }
        }
    }

    if (!closest) {
        console.warn("No valid gear nearby to stack onto");
        return;
    }

    g.level = 2;
    g.shaftParent = closest;
    closest.children.push(g);

    g.el.classList.add("level-2");

    g.el.style.left = closest.center.x - g.radius + "px";
    g.el.style.top  = closest.center.y - g.radius + "px";

    enforceShaftAlignment();
    propagate();
    updateStackUI(closest);
    updateZOrder();
}

function updateZOrder() {
    gears.forEach(g => {
        if (g.level === 2) {
            g.el.style.zIndex = 1000 + g.el.style.zIndex;
        }
    });
}

function unstackGear(g) {
    if (g.level !== 2) return;

    const p = g.shaftParent;
    if (p) p.children = p.children.filter(c => c !== g);

    g.level = 1;
    g.shaftParent = null;
    g.el.classList.remove("level-2");
    updateStackUI(p);
    propagate();
    updateZOrder();
}

// ---------- CONNECTIONS ----------
function checkConnections() {
    gears.forEach(g => g.connected = []);

    for (let i = 0; i < gears.length; i++) {
        for (let j = i + 1; j < gears.length; j++) {
            const a = gears[i];
            const b = gears[j];

            if (a.level !== b.level) continue;

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

// ---------- SNAP ----------
function snapToMesh(g) {
    for (const o of gears) {
        if (o === g || o.level !== g.level) continue;

        const dx = g.center.x - o.center.x;
        const dy = g.center.y - o.center.y;
        const d = Math.hypot(dx, dy);
        const target = g.radius + o.radius;

        if (Math.abs(d - target) < 10) {
            const a = Math.atan2(dy, dx);
            g.el.style.left = o.center.x + Math.cos(a) * target - g.radius + "px";
            g.el.style.top = o.center.y + Math.sin(a) * target - g.radius + "px";
            return;
        }
    }
}

function enforceShaftAlignment() {
    gears.forEach(g => {
        if (g.level === 2 && g.shaftParent) {
            const p = g.shaftParent;

            g.el.style.left = p.center.x - g.radius + "px";
            g.el.style.top  = p.center.y - g.radius + "px";
        }
    });
}

// ---------- POWER PROPAGATION ----------
function propagate() {
    gears.forEach(g => {
        if (!g.el.classList.contains("motor")) {
            g.speed = 0;
            g.rpm = 0;
            g.torque = 0;
        }
    });

    const queue = gears.filter(g => g.el.classList.contains("motor"));

    while (queue.length) {
        const g = queue.shift();

        // Shaft coupling: parent → children
    g.children.forEach(c => {
    if (c.rpm === 0) {
        c.speed = g.speed;
        c.rpm = g.rpm;
        c.torque = g.torque;
        queue.push(c);
    }
    });

    // Shaft coupling: child → parent
    if (g.shaftParent) {
     const p = g.shaftParent;
        if (p.rpm === 0) {
            p.speed = g.speed;
            p.rpm = g.rpm;
            p.torque = g.torque;
            queue.push(p);
        }
    }

        // Meshing
        g.connected.forEach(o => {
            if (o.rpm !== 0) return;

            const ratio = g.teeth / o.teeth;

            o.rpm = Math.abs(g.rpm * ratio);           // magnitude only
            o.speed = -Math.sign(g.speed) * o.rpm * 360 / 60; // direction flip
            o.torque = g.torque / ratio;

            queue.push(o);
        });
    }
}

function updateStackUI(parent) {
    if (!parent) return;

    // Hide parent UI if it has children
    const ui = parent.el.querySelector(".gear-ui");
    ui.style.display = parent.children.length ? "none" : "block";

    // Ensure child UI is visible
    parent.children.forEach(c => {
        c.el.querySelector(".gear-ui").style.display = "block";
    });
}

// ---------- TRASH ----------
function checkTrash(g) {
    const trash = document.getElementById("trash").getBoundingClientRect();
    const r = g.el.getBoundingClientRect();

    if (
        r.left < trash.right &&
        r.right > trash.left &&
        r.top < trash.bottom &&
        r.bottom > trash.top
    ) {
        if (g.shaftParent) unstackGear(g);
        g.el.remove();
        gears.splice(gears.indexOf(g), 1);
        propagate();
    }
}

// ---------- TRAY ----------
document.querySelectorAll(".tray-gear").forEach(t => {
    t.onmousedown = () => new Gear(+t.dataset.teeth, 300, 200);
});

document.getElementById("addCustomGear").onclick = () => {
    const t = +customTeeth.value;
    if (t >= 3) new Gear(t, 300, 200);
};

// ---------- MOTOR ----------
new Gear(8, 200, 200, true);

// ---------- LOOP ----------
let last = performance.now();
function animate(now) {
    const dt = (now - last) / 1000;
    last = now;

    enforceShaftAlignment();

    gears.forEach(g => g.rotate(dt));
    requestAnimationFrame(animate);
}
animate(last);