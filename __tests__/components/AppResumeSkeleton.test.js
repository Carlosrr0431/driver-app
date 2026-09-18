import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppResumeSkeleton } from '../../src/components/ui/AppResumeSkeleton';

function collectLabels(node) {
  const labels = [];
  const visit = (current) => {
    if (!current) return;
    if (current.props?.accessibilityLabel) {
      labels.push(current.props.accessibilityLabel);
    }
    const children = current.children || [];
    children.forEach(visit);
  };
  visit(node);
  return labels;
}

describe('AppResumeSkeleton', () => {
  it('no renderiza nada si no está visible', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(<AppResumeSkeleton visible={false} />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('muestra el overlay de actualización sin bloquear con spinner', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(<AppResumeSkeleton visible />);
    });
    const json = renderer.toJSON();
    expect(json).toBeTruthy();
    expect(collectLabels(json)).toContain('Actualizando estado');
    expect(json.props?.accessibilityRole).toBe('progressbar');
  });
});
