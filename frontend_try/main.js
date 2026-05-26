Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZTFhYThjOS1jYTVhLTQ0YWMtOGM4Zi1jMWY4YjUyZjRhMzQiLCJpZCI6NDIzMDMwLCJpYXQiOjE3NzcwMjk0Nzd9.TEKhl1wzlmsrP1sC6I6uiUMHeq-Jl22Yhc-H0q-Td2U';

// =============================================
// LAUNCH SCREEN LOGIC  (added by AI)
// Reads selected model URI and spawn coords,
// then starts the sim when the user clicks Launch.
// =============================================

let selectedModelUri = 'model/Cesium_Air.glb'; // default — matches first card
let spawnLon = 18.466;
let spawnLat = 54.377;

// Model card selection
document.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedModelUri = card.dataset.uri;
    });
});

// Spawn preset buttons
document.querySelectorAll('.spawn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.spawn-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        spawnLon = parseFloat(btn.dataset.lon);
        spawnLat = parseFloat(btn.dataset.lat);
    });
});

// Launch button — hides the launch screen and starts Cesium
document.getElementById('launch-btn').addEventListener('click', () => {
    const launchScreen = document.getElementById('launch-screen');
    launchScreen.classList.add('hiding');
    setTimeout(() => {
        launchScreen.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'block';
    }, 500);
    initCesium(selectedModelUri, spawnLon, spawnLat);
});

// Restart button — reloads the page to get back to launch screen
document.getElementById('restart-btn').addEventListener('click', () => {
    location.reload();
});

// =============================================
// MAIN SIM  — wrapped in a function so it only
// starts after the user clicks Launch.
// (added by AI: accepts modelUri, lon, lat params)
// =============================================
async function initCesium(modelUri, spawnLon, spawnLat) {
    const viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        infoBox: false,
        selectionIndicator: false,
        timeline: false,
        animation: false
    });

    // --- Load 3D Buildings with Dynamic Styling ---
    try {
        const buildingTileset = await Cesium.createOsmBuildingsAsync();
        buildingTileset.style = new Cesium.Cesium3DTileStyle({
            defines: {
                material: "${feature['building:material']}",
                type: "${feature['building']}"
            },
            color: {
                conditions: [
                    ["${material} === 'glass'", "color('skyblue', 0.7)"],
                    ["${material} === 'brick'", "color('indianred')"],
                    ["${material} === 'concrete'", "color('darkgrey')"],
                    ["${type} === 'residential'", "color('navajowhite')"],
                    ["${type} === 'commercial'", "color('lightsteelblue')"],
                    ["true", "color('gainsboro')"]
                ]
            }
        });

        viewer.scene.primitives.add(buildingTileset);
    } catch (error) {
        console.error(`Error loading 3D buildings tileset: ${error}`);
    }

    // ==========================================
    // --- Physics & Gameplay Settings ---
    // ==========================================
    const GRAVITY_ACCEL = 9.81;         // Earth's downward pull (m/s²). Higher = falls faster; Lower = floats like Mars.
    const THRUST_POWER = 50.0;          // Base engine power forward. Higher = rocket-fast jet; Lower = weak, slow acceleration.
    const ROTATION_SPEED = 0.5;         // Key responsiveness for pitch/roll. Higher = twitchy arcade; Lower = heavy cargo plane.
    const DRAG_COEFFICIENT = 0.78;       // Air resistance brake. Higher = vacuum glide; Lower = thick mud.
    const LIFT_COEFFICIENT = 9.0;       // Wing efficiency. Higher = floats upward easily on speed; Lower = slips down like a brick.
    const PLANE_MASS = 20000;           // Weight in kg. Higher = sluggish movement, stalls easily; Lower = paper-light acceleration.
    const BANK_TURN_SENSITIVITY = 0.1;  // Turning sharpness when tilted. Higher = sharp jet cuts; Lower = straight line sliding.
    const PITCH_DROP_OFF_EXPONENT = 3;  // Engine penalty during steep climbs. Higher = fast stalls; 0 = infinite vertical rocket.

    // --- State Variables ---
    let velocityWorld = new Cesium.Cartesian3(0, 0, 0); 
    let heading = Cesium.Math.toRadians(0);
    let pitch = 0.0;
    let roll = 0.0;
    const PLANE_MASS_Calc = PLANE_MASS/4000; 
    let currentPosition = Cesium.Cartesian3.fromDegrees(spawnLon, spawnLat,  500);
    let hasCrashed = false;
    let explosionEntity = null;

    // --- Input Handling (a and d keys completely removed) ---
    const keys = { w: false, s: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, ' ': false, Control: false };
    
    window.addEventListener('keydown', (e) => { 
        if (e.key in keys) {
            keys[e.key] = true;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
            }
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

    // --- Spawn Plane ---
    const shipEntity = viewer.entities.add({
        name: 'PhysicsLander',
        position: new Cesium.CallbackProperty(() => currentPosition, false),
        orientation: new Cesium.CallbackProperty(() => {
            const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
            return Cesium.Transforms.headingPitchRollQuaternion(currentPosition, hpr);
        }, false),
        model: {
            uri: modelUri, 
            //uri: "model/help.glb", 
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

        // Handle Rotations
        if (keys.ArrowUp) pitch += ROTATION_SPEED * dt;
        if (keys.ArrowDown) pitch -= ROTATION_SPEED * dt; 
        if (keys.ArrowLeft) roll -= ROTATION_SPEED * dt;
        if (keys.ArrowRight) roll += ROTATION_SPEED * dt;  
        
        // Rotation Limits
        pitch = Math.max(-Math.PI / 5, Math.min(Math.PI / 5, pitch));      
        roll = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, roll));    

        heading += Math.sin(roll) * BANK_TURN_SENSITIVITY * dt;

        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const localFrameMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(currentPosition, hpr);

        const localThrustInput = new Cesium.Cartesian3(0, 0, 0);

        let thrustMultiplier = 1.0;
        if (pitch > 0) {
            thrustMultiplier = Math.pow(Math.cos(pitch), PITCH_DROP_OFF_EXPONENT); 
        }

        localThrustInput.x = (THRUST_POWER * 0.6) * thrustMultiplier;

        if (keys.w) localThrustInput.x += (THRUST_POWER * thrustMultiplier);    // Forward affected by pitch penalty
        if (keys.s) localThrustInput.x -= THRUST_POWER;                         // Reverse/Braking

        // Local thrust direction -> World vector coordinates
        const worldThrust = Cesium.Matrix4.multiplyByPointAsVector(localFrameMatrix, localThrustInput, new Cesium.Cartesian3());

        // Calculate Spherical Gravity
        const earthCenterDirection = new Cesium.Cartesian3();
        Cesium.Cartesian3.normalize(currentPosition, earthCenterDirection); 
        
        // Calculate Aerodynamic Lift (based on forward speed and pitch)
        const forwardSpeed = Math.abs(velocityWorld.x);  
        const liftForce = LIFT_COEFFICIENT * forwardSpeed * Math.sin(pitch);
        
        const gravityVector = new Cesium.Cartesian3();
        Cesium.Cartesian3.multiplyByScalar(earthCenterDirection, -(GRAVITY_ACCEL - liftForce), gravityVector);

        // Physics Integration
        const thrustAcceleration = new Cesium.Cartesian3();
        Cesium.Cartesian3.divideByScalar(worldThrust, PLANE_MASS_Calc, thrustAcceleration);

        const totalAcceleration = new Cesium.Cartesian3();
        Cesium.Cartesian3.add(thrustAcceleration, gravityVector, totalAcceleration);

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

        // Terrain Collision & Telemetry Calculations
        const cartographic = Cesium.Cartographic.fromCartesian(nextPosition);
        const terrainHeight = viewer.scene.globe.getHeight(cartographic) || 0;

        if (cartographic.height <= terrainHeight) {
            if (!hasCrashed) {
                hasCrashed = true;
                shipEntity.model.color = Cesium.Color.TRANSPARENT; 
                
                const explosionPosition = Cesium.Cartographic.toCartesian(
                    new Cesium.Cartographic(cartographic.longitude, cartographic.latitude, terrainHeight)
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

        // Push Data to UI HTML elements
        const verticalVelocityComponent = Cesium.Cartesian3.dot(velocityWorld, earthCenterDirection);
        
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
