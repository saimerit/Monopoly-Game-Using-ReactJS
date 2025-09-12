// src/Auth.tsx

import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import {
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    type User
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

interface AuthProps {
    onLogin: (user: User) => void;
    onLogout: () => void;
    onSettingsClick: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onLogout, onSettingsClick }) => {
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

    return (
        <div className="absolute top-4 right-4 z-50">
            {user ? (
                <div className="flex items-center gap-4">
                    <p className="text-white bg-gray-800 px-3 py-2 rounded">Welcome, {user.displayName || user.email}</p>
                    <button onClick={onSettingsClick} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-2 rounded">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
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