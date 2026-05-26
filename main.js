Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZTFhYThjOS1jYTVhLTQ0YWMtOGM4Zi1jMWY4YjUyZjRhMzQiLCJpZCI6NDIzMDMwLCJpYXQiOjE3NzcwMjk0Nzd9.TEKhl1wzlmsrP1sC6I6uiUMHeq-Jl22Yhc-H0q-Td2U';

async function initCesium() {
    const viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        infoBox: false,
        selectionIndicator: false,
        timeline: false,
        animation: false
    });

    // --- Add 3D Buildings ---
try {
        const buildingTileset = await Cesium.createOsmBuildingsAsync();
        
        // Apply dynamic metadata coloring
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
                    ["true", "color('gainsboro')"] // Default color for unclassified buildings
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
    const GRAVITY_ACCEL = 9.81;    
    const THRUST_POWER = 9.0;     
    const ROTATION_SPEED = 0.5;    
    const DRAG_COEFFICIENT = 0.85;
    const LIFT_COEFFICIENT = 6.0;  

    // 💡 ADJUST HERE: Turning Sharpness
    // Higher values make the plane turn much faster when tilted sideways.
    // Try 2.0 for an agile jet, or 0.5 for a heavy commercial airliner.
    const BANK_TURN_SENSITIVITY = 0.1; 

    // 💡 ADJUST HERE: Thrust Drop-Off Severity
    // Higher values make the thrust drop off MUCH faster during a climb.
    // 1 = Mild/Linear loss, 2 = Heavy loss (realistic), 4 = Aggressive stall risk.
    const PITCH_DROP_OFF_EXPONENT = 2;

    // --- State Variables ---
    let velocityWorld = new Cesium.Cartesian3(0, 0, 0); 
    let heading = Cesium.Math.toRadians(0);
    let pitch = 0.0;
    let roll = 0.0;

    let currentPosition = Cesium.Cartesian3.fromDegrees(18.466, 54.377, 500);

    // --- Crash State ---
    let hasCrashed = false;
    let explosionEntity = null;

    // --- Input Handling (a and d keys completely removed) ---
    const keys = { w: false, s: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, ' ': false, Control: false };
    
    window.addEventListener('keydown', (e) => { 
        if (e.key in keys) {
            keys[e.key] = true;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault(); // Stop browser from scrolling up/down
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

        // 1. Handle Rotations via Arrow Keys
        if (keys.ArrowUp) pitch += ROTATION_SPEED * dt;      // Pitch Up (Nose points high)
        if (keys.ArrowDown) pitch -= ROTATION_SPEED * dt;    // Pitch Down (Nose points low)
        if (keys.ArrowLeft) roll -= ROTATION_SPEED * dt;     // Roll Left (Bank left)
        if (keys.ArrowRight) roll += ROTATION_SPEED * dt;    // Roll Right (Bank right)
        
        // 💡 ADJUST HERE: Clamping Limits
        // Adjust these if you want the plane to be able to loop completely upside down.
        // Currently limited to 36 degrees up/down and ~51 degrees left/right banking.
        pitch = Math.max(-Math.PI / 5, Math.min(Math.PI / 5, pitch));      
        roll = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, roll));    

        // --- Dynamic Turning Logic ---
        // Steeper bank angle (roll) translates directly into a faster heading turn.
        heading += Math.sin(roll) * BANK_TURN_SENSITIVITY * dt;

        // 2. Local Orientation Matrix 
        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const localFrameMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(currentPosition, hpr);

        // 3. Assemble Local Thruster Forces
        const localThrustInput = new Cesium.Cartesian3(0, 0, 0);

        // --- Pitch-Thrust Dynamic Scaling ---
        let thrustMultiplier = 1.0;
        if (pitch > 0) {
            // As pitch increases toward its limit, Math.cos gets closer to 0.
            // Using Math.pow makes the drop-off exponential based on your settings above.
            thrustMultiplier = Math.pow(Math.cos(pitch), PITCH_DROP_OFF_EXPONENT); 
        }

        // Apply the calculation to forward movement (Default cruise + manual throttle)
        localThrustInput.x = (THRUST_POWER * 0.6) * thrustMultiplier;

        if (keys.w) localThrustInput.x += (THRUST_POWER * thrustMultiplier);    // Forward affected by pitch penalty
        if (keys.s) localThrustInput.x -= THRUST_POWER;                         // Reverse/Braking
        if (keys[' ']) localThrustInput.z += THRUST_POWER;                      // Vertical VTOL Spacebar
        if (keys.Control) localThrustInput.z -= THRUST_POWER;                   // Vertical VTOL Ctrl

        // Local thrust direction -> World vector coordinates
        const worldThrust = Cesium.Matrix4.multiplyByPointAsVector(localFrameMatrix, localThrustInput, new Cesium.Cartesian3());

        // 4. Calculate Spherical Gravity
        const earthCenterDirection = new Cesium.Cartesian3();
        Cesium.Cartesian3.normalize(currentPosition, earthCenterDirection); 
        
        // 4b. Calculate Aerodynamic Lift (based on forward speed and pitch)
        const forwardSpeed = Math.abs(velocityWorld.x);  
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

        // 7. Push Data to UI HTML elements
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

initCesium();