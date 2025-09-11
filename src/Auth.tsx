// src/Auth.tsx

import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import {
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut,
    type User
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

interface AuthProps {
    onLogin: (user: User) => void;
    onLogout: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onLogout }) => {
    const [user, setUser] = useState<User | null>(null);
    
    const auth = getAuth();
    const provider = new GoogleAuthProvider();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                onLogin(currentUser);
                const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                if (!userDoc.exists()) {
                    await setDoc(doc(db, "users", currentUser.uid), {
                        name: currentUser.displayName || 'Anonymous',
                        email: currentUser.email,
                        wins: 0
                    });
                }
            } else {
                setUser(null);
                onLogout();
            }
        });
        return () => unsubscribe();
    }, [auth, onLogin, onLogout]);

    const handleGoogleSignIn = async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Error signing in with Google:", error);
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    return (
        <div className="absolute top-4 right-4 z-50">
            {user ? (
                <div className="flex items-center gap-4">
                    <p className="text-white bg-gray-800 px-3 py-2 rounded">Welcome, {user.displayName || user.email}</p>
                    <button onClick={handleLogout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">Logout</button>
                </div>
            ) : (
                <button onClick={handleGoogleSignIn} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                    Sign In with Google
                </button>
            )}
        </div>
    );
};

export default Auth;