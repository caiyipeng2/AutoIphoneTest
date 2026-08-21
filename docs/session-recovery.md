# Session recovery

Session actions are persisted before dispatch. A worker failure creates an incident and marks the action according to the selected failure policy. A recovered device may rejoin, but actions are never replayed automatically. Resolve the incident, verify the device state, and retry explicitly from the action timeline.
