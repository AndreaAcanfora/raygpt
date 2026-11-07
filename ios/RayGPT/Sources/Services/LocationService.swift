import CoreLocation

/// The user's position for "near me" questions (backend/README.md, location).
/// Sent once when a conversation starts and again when the user moves; never stored.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    /// A new position worth telling the model about (moved at least `distanceFilter`).
    var onMove: ((CLLocation) -> Void)?

    private let manager = CLLocationManager()
    private var oneShot: [CheckedContinuation<CLLocation?, Never>] = []
    private var authorization: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 250
    }

    /// The current position, or nil if permission is denied or no fix arrives within `timeout`.
    func current(timeout: TimeInterval = 5) async -> CLLocation? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { continuation in
                authorization = continuation
                manager.requestWhenInUseAuthorization()
            }
        }
        guard isAuthorized else { return nil }
        if let recent = manager.location, -recent.timestamp.timeIntervalSinceNow < 120 { return recent }

        return await withCheckedContinuation { continuation in
            oneShot.append(continuation)
            manager.requestLocation()
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(timeout))
                self.finishOneShot(with: nil)
            }
        }
    }

    func startUpdates() {
        guard isAuthorized else { return }
        manager.startUpdatingLocation()
    }

    func stopUpdates() {
        manager.stopUpdatingLocation()
    }

    private var isAuthorized: Bool {
        manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
    }

    private func finishOneShot(with location: CLLocation?) {
        let waiting = oneShot
        oneShot = []
        waiting.forEach { $0.resume(returning: location) }
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            guard manager.authorizationStatus != .notDetermined else { return }
            authorization?.resume()
            authorization = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        MainActor.assumeIsolated {
            if !oneShot.isEmpty {
                finishOneShot(with: location)
            } else {
                onMove?(location)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated { finishOneShot(with: nil) }
    }
}
