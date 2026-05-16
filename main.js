Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZTFhYThjOS1jYTVhLTQ0YWMtOGM4Zi1jMWY4YjUyZjRhMzQiLCJpZCI6NDIzMDMwLCJpYXQiOjE3NzcwMjk0Nzd9.TEKhl1wzlmsrP1sC6I6uiUMHeq-Jl22Yhc-H0q-Td2U';

async function initCesium() {
    const viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        infoBox: false,
        selectionIndicator: false,
        timeline: false,
        animation: false
    });

    const gravityConstant = 0.098;
    let verticalVelocity = 0.0;
    let speed = 0.0;
    let heading = Cesium.Math.toRadians(0);
    let pitch = 0.0;
    let roll = 0.0;

    let currentPosition = Cesium.Cartesian3.fromDegrees(18.466, 54.377, 500);

    const keys = { w: false, s: false, a: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
    window.addEventListener('keydown', (e) => { if (e.key in keys) keys[e.key] = true; });
    window.addEventListener('keyup', (e) => { if (e.key in keys) keys[e.key] = false; });

    const airplaneEntity = viewer.entities.add({
        name: 'PhysicsPlane',
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

    viewer.trackedEntity = airplaneEntity;

    viewer.scene.preUpdate.addEventListener(function(scene, time) {
        if (keys.w) speed += 0.7;
        if (keys.s) speed = Math.max(0, speed - 0.5);
        
        if (keys.ArrowUp) pitch += 0.01;
        if (keys.ArrowDown) pitch -= 0.01;
        if (keys.ArrowLeft) roll -= 0.02;
        if (keys.ArrowRight) roll += 0.02;

        const turnRate = 0.0001; 
        heading += roll * (speed * turnRate);

        speed *= 0.995;
        pitch *= 0.98;
        roll *= 0.95; 

        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const matrix = Cesium.Transforms.headingPitchRollToFixedFrame(currentPosition, hpr);
        
        const step = speed * 0.1; 
        const movement = new Cesium.Cartesian3(step, 0, step * Math.sin(pitch));
        
        if (!keys.ArrowLeft && !keys.ArrowRight) {
            roll *= 0.95;
        }

        currentPosition = Cesium.Matrix4.multiplyByPoint(matrix, movement, new Cesium.Cartesian3());
    });
}

initCesium();