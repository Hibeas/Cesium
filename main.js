Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZTFhYThjOS1jYTVhLTQ0YWMtOGM4Zi1jMWY4YjUyZjRhMzQiLCJpZCI6NDIzMDMwLCJpYXQiOjE3NzcwMjk0Nzd9.TEKhl1wzlmsrP1sC6I6uiUMHeq-Jl22Yhc-H0q-Td2U';

async function initCesium() {
    const viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        infoBox: false,
        selectionIndicator: false,
        timeline: false,
        animation: false
    });

    // --- Physics Settings ---
    const GRAVITY_ACCEL = 9.81;    
    const THRUST_POWER = 18.0;     // Slightly boosted thrust to make climbing easier
    const ROTATION_SPEED = 1.5;    
    const DRAG_COEFFICIENT = 0.85; 

    // --- State Variables ---
    let velocityWorld = new Cesium.Cartesian3(0, 0, 0); 
    let heading = Cesium.Math.toRadians(0);
    let pitch = 0.0;
    let roll = 0.0;

    let currentPosition = Cesium.Cartesian3.fromDegrees(18.466, 54.377, 500);

    // --- CRITICAL Fixed Input Handling ---
    const keys = { w: false, s: false, a: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
    
    window.addEventListener('keydown', (e) => { 
        if (e.key in keys) {
            keys[e.key] = true;
            // PREVENT BROWSER SCROLLING for ArrowUp and ArrowDown
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
            }
            // Visual UI update
            const element = document.getElementById(`key-${e.key}`);
            if (element) element.classList.add('active');
        }
    });

    window.addEventListener('keyup', (e) => { 
        if (e.key in keys) {
            keys[e.key] = false;
            const element = document.getElementById(`key-${e.key}`);
            if (element) element.classList.remove('active');
        }
    });

    // --- Spawn Spaceship ---
    const shipEntity = viewer.entities.add({
        name: 'PhysicsLander',
        position: new Cesium.CallbackProperty(() => currentPosition, false),
        orientation: new Cesium.CallbackProperty(() => {
            const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
            return Cesium.Transforms.headingPitchRollQuaternion(currentPosition, hpr);
        }, false),
        model: {
            uri: "model/Cesium_Air.glb", 
            minimumPixelSize: 128,
            maximumScale: 20000
        }
    });

    viewer.trackedEntity = shipEntity;

    let lastTime = performance.now();

    viewer.scene.preUpdate.addEventListener(function(scene, time) {
        const now = performance.now();
        const dt = (now - lastTime) / 1000.0;
        lastTime = now;

        if (dt <= 0 || dt > 0.1) return; 

        // 1. Handle Rotations
        if (keys.ArrowLeft) heading -= ROTATION_SPEED * dt;
        if (keys.ArrowRight) heading += ROTATION_SPEED * dt;

        // 2. Local Orientation Matrix 
        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const localFrameMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(currentPosition, hpr);

        // 3. Assemble Local Thruster Forces
        const localThrustInput = new Cesium.Cartesian3(0, 0, 0);

        if (keys.w) localThrustInput.x += THRUST_POWER;    
        if (keys.s) localThrustInput.x -= THRUST_POWER;    
        if (keys.a) localThrustInput.y += THRUST_POWER;    
        if (keys.d) localThrustInput.y -= THRUST_POWER;    
        if (keys.ArrowUp) localThrustInput.z += THRUST_POWER;   // Fights gravity directly
        if (keys.ArrowDown) localThrustInput.z -= THRUST_POWER; 

        // Local thrust direction -> World vector coordinates
        const worldThrust = Cesium.Matrix4.multiplyByPointAsVector(localFrameMatrix, localThrustInput, new Cesium.Cartesian3());

        // 4. Calculate Spherical Gravity
        const earthCenterDirection = new Cesium.Cartesian3();
        Cesium.Cartesian3.normalize(currentPosition, earthCenterDirection); 
        
        const gravityVector = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(earthCenterDirection, -GRAVITY_ACCEL, gravityVector);

        // 5. Physics Integration
        const totalAcceleration = new Cesium.Cartesian3();
        Cesium.Cartesian3.add(worldThrust, gravityVector, totalAcceleration);

        const velocityChange = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(totalAcceleration, dt, velocityChange);
        Cesium.Cartesian3.add(velocityWorld, velocityChange, velocityWorld);

        // Atmospheric drag dampening
        Cesium.Cartesian3.multiplyByScalar(velocityWorld, Math.pow(DRAG_COEFFICIENT, dt), velocityWorld);

        // Calculate Next Position
        const positionChange = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(velocityWorld, dt, positionChange);
        const nextPosition = new Cesium.Cartesian3();
        Cesium.Cartesian3.add(currentPosition, positionChange, nextPosition);

        // 6. Terrain Collision & Telemetry Calculations
        const cartographic = Cesium.Cartographic.fromCartesian(nextPosition);
        const terrainHeight = viewer.scene.globe.getHeight(cartographic) || 0;

        if (cartographic.height <= terrainHeight) {
            cartographic.height = terrainHeight;
            currentPosition = Cesium.Cartographic.toCartesian(cartographic);
            velocityWorld = Cesium.Cartesian3.ZERO; 
        } else {
            currentPosition = nextPosition;
        }

        // 7. Push Data to UI HTML elements
        // Projecting the world velocity vector onto the vertical Earth axis to get true climb speed
        const verticalVelocityComponent = Cesium.Cartesian3.dot(velocityWorld, earthCenterDirection);
        document.getElementById('telemetry-alt').innerText = Math.round(cartographic.height);
        document.getElementById('telemetry-vy').innerText = verticalVelocityComponent.toFixed(2);
    });
}

initCesium(); 
