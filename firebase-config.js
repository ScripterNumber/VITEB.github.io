import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCuJuCBSZvAPM8Wd4uE90Gnle0ENJoBjOQ",
    authDomain: "messenger-wave-new.firebaseapp.com",
    databaseURL: "https://messenger-wave-new-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "messenger-wave-new",
    storageBucket: "messenger-wave-new.firebasestorage.app",
    messagingSenderId: "893049459680",
    appId: "1:893049459680:web:7bf9b3d43c1bab8f8a5185"
};

export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
