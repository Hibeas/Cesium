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
    const LIFT_COEFFICIENT = 6.0;  // Higher = more lift from forward speed 

    // --- State Variables ---
    let velocityWorld = new Cesium.Cartesian3(0, 0, 0); 
    let heading = Cesium.Math.toRadians(0);
    let pitch = 0.0;
    let roll = 0.0;

    let currentPosition = Cesium.Cartesian3.fromDegrees(18.466, 54.377, 500);

    // --- Crash State ---
    let hasCrashed = false;
    let explosionEntity = null;

    // --- CRITICAL Fixed Input Handling ---
    const keys = { w: false, s: false, a: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, ' ': false, Control: false };
    
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
        if (keys.ArrowUp) pitch += ROTATION_SPEED * dt;      // Tilt nose up
        if (keys.ArrowDown) pitch -= ROTATION_SPEED * dt;    // Tilt nose down
        if (keys.ArrowLeft) roll -= ROTATION_SPEED * dt;     // Roll left (bank left)
        if (keys.ArrowRight) roll += ROTATION_SPEED * dt;    // Roll right (bank right)
        if (keys.a) heading -= ROTATION_SPEED * dt;          // Turn left
        if (keys.d) heading += ROTATION_SPEED * dt;          // Turn right
        
        // Clamp pitch and roll to prevent extreme tilting
        pitch = Math.max(-Math.PI / 5, Math.min(Math.PI / 5, pitch));      // Limit nose up/down to 60°
        roll = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, roll));    // Limit left/right tilt to ~72°

        // 2. Local Orientation Matrix 
        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const localFrameMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(currentPosition, hpr);

        // 3. Assemble Local Thruster Forces
        const localThrustInput = new Cesium.Cartesian3(0, 0, 0);

        // Default forward thrust so plane always moves
        localThrustInput.x = THRUST_POWER * 0.6;

        if (keys.w) localThrustInput.x += THRUST_POWER;    // Forward
        if (keys.s) localThrustInput.x -= THRUST_POWER;    // Backward
        if (keys[' ']) localThrustInput.z += THRUST_POWER;   // Up (Space - fights gravity)
        if (keys.Control) localThrustInput.z -= THRUST_POWER;  // Down (Ctrl) 

        // Local thrust direction -> World vector coordinates
        const worldThrust = Cesium.Matrix4.multiplyByPointAsVector(localFrameMatrix, localThrustInput, new Cesium.Cartesian3());

        // 4. Calculate Spherical Gravity
        const earthCenterDirection = new Cesium.Cartesian3();
        Cesium.Cartesian3.normalize(currentPosition, earthCenterDirection); 
        
        // 4b. Calculate Aerodynamic Lift (based on forward speed and pitch)
        const forwardSpeed = Math.abs(velocityWorld.x);  // Speed component
        const liftForce = LIFT_COEFFICIENT * forwardSpeed * Math.sin(pitch);
        
        const gravityVector = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(earthCenterDirection, -(GRAVITY_ACCEL - liftForce), gravityVector);

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
            if (!hasCrashed) {
                // Plane crashed - spawn explosion and hide plane
                hasCrashed = true;
                shipEntity.model.color = Cesium.Color.TRANSPARENT; // Hide plane
                
                // Spawn explosion at crash location
                const explosionPosition = Cesium.Cartographic.toCartesian(
                    new Cesium.Cartographic(cartographic.longitude, cartographic.latitude, terrainHeight + 10)
                );
                
                explosionEntity = viewer.entities.add({
                    name: 'Explosion',
                    position: explosionPosition,
                    model: {
                        uri: "model/scene.gltf",
                        minimumPixelSize: 128,
                        maximumScale: 20000
                    }
                });
            }
            
            cartographic.height = terrainHeight;
            currentPosition = Cesium.Cartographic.toCartesian(cartographic);
            velocityWorld = Cesium.Cartesian3.ZERO; 
        } else {
            currentPosition = nextPosition;
        }

        // 7. Push Data to UI HTML elements
        // Projecting the world velocity vector onto the vertical Earth axis to get true climb speed
        const verticalVelocityComponent = Cesium.Cartesian3.dot(velocityWorld, earthCenterDirection);
        
        // Calculate horizontal velocity by removing vertical component (like car speedometer)
        const verticalVelocityVector = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(earthCenterDirection, verticalVelocityComponent, verticalVelocityVector);
        
        const horizontalVelocityVector = new Cesium.Cartesian3();
        Cesium.Cartesian3.subtract(velocityWorld, verticalVelocityVector, horizontalVelocityVector);
        
        const normalVelocityComponent = Cesium.Cartesian3.magnitude(horizontalVelocityVector);
        
        document.getElementById('telemetry-alt').innerText = Math.round(cartographic.height);
        document.getElementById('telemetry-vy').innerText = verticalVelocityComponent.toFixed(2);
        document.getElementById('telemetry-vn').innerText = normalVelocityComponent.toFixed(2);
    });
}

initCesium(); 
