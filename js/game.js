// Módulos necesarios
import * as THREE from "../lib/three.module.js";
import { GLTFLoader } from "../lib/GLTFLoader.module.js";
import { OrbitControls } from "../lib/OrbitControls.module.js";
import { GUI } from "../lib/lil-gui.module.min.js";

// VARIABLES GLOBALES
let renderer, scene, camera;
let mixer;           // Para animaciones (del lobby o del coche)
const clock = new THREE.Clock();

// Variables para el lobby y juego
let figures;         // Grupo para el modelo del lobby
let carMesh;         // Mesh del coche en la escena de juego
let trackMesh;       // Mesh de la pista (para colisiones con raycaster)

// Variable para controlar el estado del juego
let gameReady = false;

// Objeto para almacenar teclas pulsadas
const keysPressed = {};

//Variables para control del crono
let startTime=0;
let lapTime=0;
let timerInterval;
let lapStarted = false;

// INICIALIZACIÓN DEL LOBBY
initLobby();
loadLobbyScene();
render();

// Inicializa el renderer, escena y cámara para el lobby
function initLobby() {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(500, 500);
  document.getElementById('container').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(-43.48, 22.356, -3.83526);
  camera.lookAt(0, 1, 0);

  // Se puede usar OrbitControls para el lobby si se desea
  //new OrbitControls(camera, renderer.domElement);
}

// Carga del modelo de introducción en el lobby
function loadLobbyScene() {
  const ambientLight = new THREE.AmbientLight(0xe1ebfc);
  scene.add(ambientLight);

  const gltfLoader = new GLTFLoader();
  figures = new THREE.Object3D();
  scene.add(figures);

  gltfLoader.load(
    '../models/driverFull.gltf',
    (gltf) => {
      const modeloIntro = gltf.scene;
      modeloIntro.position.set(0, -1, 0);
      modeloIntro.rotation.y = -Math.PI / 2;
      figures.add(modeloIntro);

      // Animation mixer para el modelo de intro
      mixer = new THREE.AnimationMixer(modeloIntro);
      const driveClip = THREE.AnimationClip.findByName(gltf.animations, "drive");
      if (driveClip) {
        const action = mixer.clipAction(driveClip);
        action.timeScale = 8.0;
        action.play();
      } else {
        console.warn('No se encontró la animación "drive" en el modelo.');
      }
    },
    undefined,
    (error) => {
      console.error(error);
    }
  );
}

function update(delta)
{
    // Rotacion de cada uno sobre sí mismo
    figures.children.forEach( obj => {
        obj.rotation.y += 0.001;
    });

    //Actualizar AnimationMixer
    if (mixer) {
        mixer.update(delta);
    }
}

// Render loop común (se actualizará luego el movimiento del coche)
function render() {
  requestAnimationFrame(render);
  const delta = clock.getDelta();

  // Actualiza el mixer (ya sea del lobby o del coche)
  update(delta);

  // Si el juego ya está iniciado, actualiza el movimiento del coche, la cámara y su altura
  if (gameReady && carMesh) {
    updateCarMovement(delta);
    updateCameraFollow();
    updateCarHeight();
    checkFinishLineCrossing();
  }

  update();

  renderer.render(scene, camera);
}

// EVENTOS DE TECLADO PARA MOVIMIENTO
window.addEventListener("keydown", (event) => {
  keysPressed[event.key.toLowerCase()] = true;
});
window.addEventListener("keyup", (event) => {
  keysPressed[event.key.toLowerCase()] = false;
});

function updateCarMovement(delta) {
    if (!carMesh) return;
    const moveSpeed = 10; // unidades por segundo
    const rotationSpeed = Math.PI; // radianes por segundo
  
    let forward = new THREE.Vector3();
    carMesh.getWorldDirection(forward);
  
    // 🚗 Detectar colisión antes de moverse
    if (keysPressed["w"] && !checkWallCollisions(forward)) {
        carMesh.position.add(forward.clone().multiplyScalar(moveSpeed * delta));
    }
    if (keysPressed["s"]) {
        let backward = forward.clone().multiplyScalar(-1); // Crear un nuevo vector hacia atrás
        if (!checkWallCollisions(backward)) {
        carMesh.position.add(backward.multiplyScalar(moveSpeed * delta));
        }
    }
  
  
    // Rotación sin restricciones
    if (keysPressed["a"]) {
      carMesh.rotation.y += rotationSpeed * delta;
    }
    if (keysPressed["d"]) {
      carMesh.rotation.y -= rotationSpeed * delta;
    }
  }
  

// Función para actualizar la cámara siguiendo al coche (vista en tercera persona)
function updateCameraFollow() {
  if (!carMesh) return;
  // Offset relativo al coche (por ejemplo, 5 unidades arriba y 10 atrás)
  let offset = new THREE.Vector3(0, 5, -10);
  // Aplica la rotación del coche para que el offset siga su orientación
  offset.applyQuaternion(carMesh.quaternion);
  // Posición deseada para la cámara
  const desiredPos = new THREE.Vector3().copy(carMesh.position).add(offset);
  camera.position.lerp(desiredPos, 0.1); // Movimiento suave
  camera.lookAt(carMesh.position);
}

// Función para ajustar la altura del coche sobre la pista usando Raycaster
function updateCarHeight() {
  if (!carMesh || !trackMesh) return;
  // Creamos un raycaster
  const raycaster = new THREE.Raycaster();
  // Origen: desde una posición elevada sobre el coche
  const origin = new THREE.Vector3().copy(carMesh.position);
  origin.y += 10; // 10 unidades arriba del coche
  // Dirección: hacia abajo
  const down = new THREE.Vector3(0, -1, 0);
  raycaster.set(origin, down);
  
  // Calcula intersecciones contra la pista (incluyendo subobjetos)
  const intersections = raycaster.intersectObject(trackMesh, true);
  if (intersections.length > 0) {
    // Tomamos la intersección más cercana
    const intersect = intersections[0];
    const clearance = 2; // separación deseada entre el coche y la pista
    // Ajusta la posición Y del coche
    carMesh.position.y = intersect.point.y + clearance;
  }
}

function checkWallCollisions(direction) {
    if (!carMesh || !trackMesh) return false;
  
    const raycaster = new THREE.Raycaster();
    const rayOrigin = new THREE.Vector3().copy(carMesh.position);
    const rayDirection = direction.clone().normalize(); // Normalizamos la dirección del rayo
  
    raycaster.set(rayOrigin, rayDirection);
  
    const intersections = raycaster.intersectObject(trackMesh, true);
    if (intersections.length > 0) {
      const distance = intersections[0].distance;
      if (distance < 3.0) { // Si la pared está a menos de 1 unidad, bloquear movimiento
        return true;
      }
    }
  
    return false;
  }
  

// EVENTOS DE INTERFAZ: Cambio del lobby a la escena del juego
document.getElementById('play').addEventListener('click', () => {
  document.getElementById('play').style.display = 'none';
  document.getElementById('musicIntro').pause();
  document.getElementById('inicio').style.display = 'none';
  document.getElementById('ready').style.display = 'block';
  document.body.style.backgroundImage = 'none';
  document.body.style.backgroundColor = '#000';

  let container = document.getElementById('container');
  container.style.display = 'block';
  container.style.width = window.innerWidth + 'px';
  container.style.height = window.innerHeight + 'px';
  updateAspectRatio();

  initGame(); // Inicializa la escena de juego
});

document.getElementById('ready').addEventListener('click', () => {
  document.getElementById('ready').style.display = 'none';
  document.getElementById('container').style.display = 'block';
  document.getElementById('container').style.width = '100%';
  document.getElementById('container').style.height = '100%';

  document.getElementById('countdown').style.display = 'block';
  document.getElementById('musicCountdown').play();

  setTimeout(() => {
    document.getElementById('musicRace').play();
    gameReady = true;

    startTimer();
  }, 6000);

  setTimeout(() => {
    document.getElementById('countdown').style.display = 'none';
    // Si countdownMusic no existe, puedes usar:
    // document.getElementById('musicCountdown').pause();
    gameReady = true;
  }, 7000);
});

// Actualiza el tamaño del renderer y la cámara al redimensionar
function updateAspectRatio() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', updateAspectRatio);

// INICIALIZACIÓN DE LA ESCENA DE JUEGO (sin físicas)
function initGame() {
  // Limpia la escena anterior
  while (scene.children.length > 0) {
    scene.remove(scene.children[0]);
  }
  
  // Crea una nueva escena para el juego
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  
  // Configura una nueva cámara en tercera persona
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(-65, 20, 11);
  // (Opcional) Usa OrbitControls para depuración:
  // new OrbitControls(camera, renderer.domElement);
  
  // Agrega luces para el juego
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(10, 10, 5);
  scene.add(directionalLight);
  
  // Carga los modelos del juego (coche y pista)
  loadGameModels();

  //drawFinishLine();
}

// Carga de modelos para la escena de juego (sin físicas)
function loadGameModels() {
  const gltfLoader = new GLTFLoader();
  
  // Cargar el coche
  gltfLoader.load(
    '../models/driverFull.gltf',
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(0.08, 0.08, 0.08);
      carMesh.position.set(-75, 13, 11);
      carMesh.rotation.y = -Math.PI / 2;
      scene.add(carMesh);
      
      camera.lookAt(carMesh.position);
      
      // Animation mixer (opcional)
      mixer = new THREE.AnimationMixer(carMesh);
      const driveClip = THREE.AnimationClip.findByName(gltf.animations, "drive");
      if (driveClip) {
        const action = mixer.clipAction(driveClip);
        action.timeScale = 8.0;
        action.play();
      }
    },
    undefined,
    (error) => {
      console.error('Error loading car:', error);
    }
  );
  
  // Cargar la pista y guardar el mesh globalmente para el raycaster
  gltfLoader.load(
    '../models/warioStadium/wStadium.gltf',
    (gltf) => {
      trackMesh = gltf.scene;
      trackMesh.scale.set(1, 1, 1);
      scene.add(trackMesh);
    },
    undefined,
    (error) => {
      console.error('Error loading track:', error);
    }
  );
}

//Final del juego
const finishLineStart = new THREE.Vector3(-75, 13, 5);  // Punto A de la línea
const finishLineEnd = new THREE.Vector3(-75, 13, 15);  // Punto B de la línea
const finishLineThreshold = 6.0; // Margen de error para detectar cruce
function drawFinishLine() {
    const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      finishLineStart, finishLineEnd
    ]);
  
    const finishLine = new THREE.Line(geometry, material);
    scene.add(finishLine);
}

function pointLineDistance(point, lineStart, lineEnd) {
  // Convertir a 2D
  const line = lineEnd.clone().sub(lineStart);
  const t = ((point.x - lineStart.x) * line.x + (point.y - lineStart.y) * line.y) / line.lengthSq();
  // Limitar t entre 0 y 1 para obtener la proyección sobre el segmento
  const tClamped = Math.max(0, Math.min(1, t));
  const projection = lineStart.clone().add(line.multiplyScalar(tClamped));
  return point.distanceTo(projection);
}

let elapsedTime;
function startTimer(){
    startTime = performance.now();
    document.getElementById('timer').style.display = 'block';

    timerInterval = setInterval(() => {
    elapsedTime = performance.now() - startTime;
    document.getElementById('timer').innerText = formatTime(elapsedTime);
    }, 10);
}

function formatTime(milliseconds) {
    let totalSeconds = Math.floor(milliseconds / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    let millis = Math.floor(milliseconds % 1000);
    
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}

let lastSide = null; // Para guardar de qué lado estaba el coche antes

function checkFinishLineCrossing() {
  if (!carMesh) return;

  // Obtenemos la posición 2D del coche
  const carPosition2D = new THREE.Vector2(carMesh.position.x, carMesh.position.z);
  const start2D = new THREE.Vector2(finishLineStart.x, finishLineStart.z);
  const end2D = new THREE.Vector2(finishLineEnd.x, finishLineEnd.z);

  // Calculamos la distancia del coche a la línea de meta
  const distance = pointLineDistance(carPosition2D, start2D, end2D);

  // Solo comprobamos el cruce si el coche está cerca de la línea
  if (distance < finishLineThreshold) {
    // Calculamos el producto cruzado para determinar el lado
    const crossProduct = (end2D.x - start2D.x) * (carPosition2D.y - start2D.y) - 
                         (end2D.y - start2D.y) * (carPosition2D.x - start2D.x);
    const currentSide = crossProduct > 0 ? 1 : -1;
    
    // Si ya habíamos registrado un lado y se ha cambiado, consideramos que se cruzó la línea
    if (lastSide !== null && lastSide !== currentSide) {
      clearInterval(timerInterval);
      document.getElementById('timer').innerText = formatTime(elapsedTime);
      
      document.getElementById('musicRace').pause();
      alert(`¡Vuelta completada en ${formatTime(elapsedTime)}!`);
      
      gameReady = false; // Detiene el juego
    }
    lastSide = currentSide;
  }
}
  