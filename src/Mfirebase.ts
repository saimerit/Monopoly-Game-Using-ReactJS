import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your Firebase configuration object
const firebaseConfig = {
 apiKey: "AIzaSyB3mr1g-Z4NCP2pYtLDnqhv8qo8mIrEO4Y",
 authDomain: "monopoly-game-2025-pero.firebaseapp.com",
 projectId: "monopoly-game-2025-pero",
 storageBucket: "monopoly-game-2025-pero.appspot.com",
 messagingSenderId: "104608671452",
 appId: "1:104608671452:web:e8725aa7348c4803f17619"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
