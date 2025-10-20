// src/Settings.tsx

import React, { useState, useEffect } from 'react';
import { getAuth, signOut, type User } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from './Mfirebase';

interface SettingsProps {
    user: User;
    onLogout: () => void;
    onBack: () => void;
    showAlert: (message: string) => void;
}

const Settings: React.FC<SettingsProps> = ({ user, onLogout, onBack, showAlert }) => {
    const [gameName, setGameName] = useState("");
    const auth = getAuth();

    useEffect(() => {
        const fetchGameName = async () => {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists() && userDoc.data().gameName) {
                setGameName(userDoc.data().gameName);
            } else {
                setGameName(user.displayName || "");
            }
        };
        fetchGameName();
    }, [user]);

    const handleNameChange = async () => {
        if (auth.currentUser) {
            try {
                await setDoc(doc(db, "users", auth.currentUser.uid), { gameName }, { merge: true });
                showAlert("In-game name updated successfully!");
            } catch (error) {
                console.error("Error updating in-game name:", error);
                showAlert("Failed to update in-game name.");
            }
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            onLogout();
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    return (
        <div className="max-w-md mx-auto">
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 shadow-lg">
                <h2 className="text-2xl font-semibold mb-4">Settings</h2>
                <div className="mb-4">
                    <label htmlFor="gameName" className="block text-sm font-medium text-gray-300 mb-2">In-Game Name</label>
                    <input
                        type="text"
                        id="gameName"
                        value={gameName}
                        onChange={(e) => setGameName(e.target.value)}
                        className="w-full p-2 bg-gray-700 border border-gray-500 rounded text-white"
                    />
                    <button onClick={handleNameChange} className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                        Save In-Game Name
                    </button>
                </div>
                <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-300">Profile Picture</h3>
                    <p className="text-sm text-gray-400">Profile picture feature coming soon!</p>
                </div>
                <button onClick={handleLogout} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mb-4">
                    Logout
                </button>
                <button onClick={onBack} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded">
                    Back to Lobby
                </button>
            </div>
        </div>
    );
};

export default Settings;