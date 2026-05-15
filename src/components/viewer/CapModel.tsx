import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useConfigStore, type CapConfig } from '../../store/configStore';
import { buildCap } from '../../utils/geometry';

declare global {
    interface Window {
        __chaseGroup?: THREE.Group;
    }
}

function applyVisibility(grp: THREE.Group, c: CapConfig) {
    grp.traverse((child) => {
        switch (child.name) {
            case 'mount_skirt':
                child.visible = (c.mount === 'skirt');
                break;
            case 'mount_pitched_skirt':
                child.visible = (c.mount === 'pitched_skirt');
                break;
            case 'mount_top_mount':
                child.visible = (c.mount === 'top_mount');
                break;
            case 'mount_skirt_drip_edge':
            case 'mount_pitched_skirt_drip_edge':
                child.visible = c.drip_edge;
                break;
            case 'screen_top_rail':
                child.visible = c.lid_type !== 'hip';
                break;
            case 'lid_flat':
                child.visible = (c.lid_type === 'flat');
                break;
            case 'lid_hip':
                child.visible = (c.lid_type === 'hip');
                break;
            case 'lid_hip_ridge':
                child.visible = (c.lid_type === 'hip_ridge');
                break;
            case 'lid_standing_seam':
                child.visible = (c.lid_type === 'standing_seam');
                break;
        }
    });
}

export function CapModel() {
    const rootRef = useRef<THREE.Group>(null);
    const capRootRef = useRef<THREE.Group>(null);

    const config = useConfigStore(state => state);

    const [mountTime] = useState(() => performance.now());

    useFrame(() => {
        const elapsed = (performance.now() - mountTime) / 1000;
        if (elapsed < 3 && rootRef.current) {
            // Slower, subtler wobble animation for the first 3 seconds
            const progress = elapsed / 3;
            const amplitude = 0.08 * (1 - progress); 
            rootRef.current.rotation.y = Math.sin(elapsed * Math.PI * 1.5) * amplitude;
        } else if (rootRef.current && rootRef.current.rotation.y !== 0) {
            rootRef.current.rotation.y = 0; // snap back exactly
        }
    });

    // Rebuild full geometry when dimensions change
    useEffect(() => {
        const grp = capRootRef.current;
        if (!grp) return;

        // Clean up old geometry and materials
        grp.traverse(c => {
            const mesh = c as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        });
        grp.clear();

        // Rebuild full procedural geometry and attach to capRoot
        try {
            buildCap(grp, config);
            // After building, apply visibility immediately
            applyVisibility(grp, config);
        } catch (e) {
            console.error("Failed to build geometry", e);
        }
    }, [
        config.width, config.length, config.vertical_skirt, config.horizontal_skirt, 
        config.flange_width, config.screen_height, config.lid_overhang, 
        config.lid_pitch, config.lid_type, config.cross_break,
        config.material, config.powder_coat, config.powder_coat_color
    ]);

    // Fast visibility toggle without rebuild
    useEffect(() => {
        const grp = capRootRef.current;
        if (!grp) return;
        applyVisibility(grp, config);
    }, [config.mount, config.lid_type, config.drip_edge]);

    return (
        <group
            ref={(node) => {
                rootRef.current = node;
                if (node) window.__chaseGroup = node;
            }}
        >
            <group ref={capRootRef} name="cap_root" />
        </group>
    );
}
