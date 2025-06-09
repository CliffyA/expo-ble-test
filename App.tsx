import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import BleManager, {
  BleScanCallbackType,
  BleScanMatchMode,
  BleScanMode,
  Peripheral,
} from "react-native-ble-manager";

type AppState =
  | "initial"
  | "initialized"
  | "scanning"
  | "scan_complete"
  | "error";

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

export default function App() {
  // *** State
  const [state, setState] = useState<AppState>("initial");
  const [errorMessage, setErrorMessage] = useState("");
  const [peripherals, setPeripherals] = useState<Record<string, Peripheral>>(
    {}
  );

  // *** Events
  const handleStopScan = useCallback(() => {
    setState(
      (inState): AppState =>
        inState === "scanning" ? "scan_complete" : inState
    );
  }, [setState]);

  const handleDiscoverPeripheral = useCallback(
    (peripheral: Peripheral) => {
      setPeripherals((inPeripherals) => ({
        ...inPeripherals,
        [peripheral.id]: peripheral,
      }));
    },
    [setPeripherals]
  );

  useEffect(() => {
    const listeners = [
      bleManagerEmitter.addListener(
        "BleManagerDiscoverPeripheral",
        handleDiscoverPeripheral
      ),
      bleManagerEmitter.addListener("BleManagerStopScan", handleStopScan),
    ];
    return () => {
      for (const listener of listeners) {
        listener.remove();
      }
    };
  }, []);

  const initialize = async () => {
    try {
      // permissions
      if (Platform.OS === "android" && Platform.Version >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        if (!result) {
          setErrorMessage("Failed to request permissions");
          setState("error");
          return;
        }
      } else if (Platform.OS === "android" && Platform.Version >= 23) {
        const checkResult = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );

        if (!checkResult) {
          const requestResult = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );

          if (!requestResult) {
            setErrorMessage("User refuses runtime permission android");
            setState("error");
            return;
          }
        }
      }

      await BleManager.enableBluetooth();
      await BleManager.start({ showAlert: false });
      setState("initialized");
    } catch {
      setState("error");
      setErrorMessage("Error during initialize");
    }
  };

  useEffect(() => {
    initialize();
  }, []);

  const beginScan = useCallback(async () => {
    try {
      setState("scanning");
      setPeripherals({});

      const SECONDS_TO_SCAN_FOR = 0;
      const SERVICE_UUIDS: string[] = [];
      const ALLOW_DUPLICATES = false;
      await BleManager.scan(
        SERVICE_UUIDS,
        SECONDS_TO_SCAN_FOR,
        ALLOW_DUPLICATES,
        {
          matchMode: BleScanMatchMode.Aggressive,
          scanMode: BleScanMode.LowLatency,
          callbackType: BleScanCallbackType.AllMatches,
        }
      );
    } catch (error) {
      setState("error");
      setErrorMessage("BLE scan error thrown");
    }
  }, [state, setState, setErrorMessage]);

  const stopScan = useCallback(async () => {
    try {
      //setState("scan_complete");
      await BleManager.stopScan();
    } catch (error) {
      setState("error");
      setErrorMessage("stop scan error thrown");
    }
  }, [setState, setErrorMessage]);

  const parseAtmotubeDatum = useCallback((peripheral: Peripheral) => {
    if (peripheral.name !== "ATMOTUBE") return null;

    const rawBytes = peripheral.advertising.rawData?.bytes;
    if (!rawBytes) return null;

    if (rawBytes.length !== 62) return null;

    let index = 0;

    // Validate Flags
    if (
      rawBytes[index++] !== 2 ||
      rawBytes[index++] !== 0x1 ||
      rawBytes[index++] !== 0x6
    )
      return null;

    // Validate Manufacturer Specific Data
    if (rawBytes[index++] !== 15 || rawBytes[index++] !== 0xff) return null;

    const companyIdentifier = (rawBytes[index++] << 8) + rawBytes[index++];
    const VOC = (rawBytes[index++] << 8) + rawBytes[index++];
    const deviceId =
      rawBytes[index++].toString(16) + rawBytes[index++].toString(16);
    const humidity = rawBytes[index++];
    const temperature = rawBytes[index++];
    const pressure =
      ((rawBytes[index++] << 24) +
        (rawBytes[index++] << 16) +
        (rawBytes[index++] << 8) +
        rawBytes[index++]) /
      100;
    const infoByte = rawBytes[index++];
    const battery = rawBytes[index++];

    // Complete local name ("ATMOTUBE")
    if (rawBytes[index++] !== 9 || rawBytes[index++] !== 0x9) return null;
    index += 9;

    // Complete List of 128-bit Service Class UUIDs (May only be ATMOTUBE pro)
    if (rawBytes[index++] !== 17 || rawBytes[index++] !== 0x7) index += 17 - 1;

    // Manufacturer Specific Data (scan response)
    if (rawBytes[index++] !== 12 || rawBytes[index++] !== 0xff) return null;

    const companyIdentifier2 = (rawBytes[index++] << 8) + rawBytes[index++];
    const PM1 = (rawBytes[index++] << 8) + rawBytes[index++];
    const PM25 = (rawBytes[index++] << 8) + rawBytes[index++];
    const PM10 = (rawBytes[index++] << 8) + rawBytes[index++];
    const firmware =
      rawBytes[index++] + "." + rawBytes[index++] + "." + rawBytes[index++];

    return {
      VOC,
      deviceId,
      humidity,
      temperature,
      pressure,
      battery,
      PM1,
      PM25,
      PM10,
      firmware,
    };
  }, []);

  switch (state) {
    case "initial":
      return (
        <View style={styles.container}>
          <Text>Starting up...</Text>
        </View>
      );
    case "initialized":
      return (
        <View style={styles.container}>
          <Text>Ready to start scanning...</Text>
          <Button title="Begin Scan" onPress={beginScan} />
        </View>
      );
    case "scanning":
    case "scan_complete":
      const keys = Object.keys(peripherals);
      return (
        <View style={styles.container}>
          {state === "scanning" && (
            <>
              <Text>Scanning...</Text>
              <Button title="Stop" onPress={stopScan} />
            </>
          )}
          {state === "scan_complete" && (
            <>
              <Text>Scan complete</Text>
              <Button title="Rescan" onPress={beginScan} />
            </>
          )}
          <Text>{keys.length} found</Text>

          <>
            {keys.map((key) => {
              const peripheral = peripherals[key];
              const atmotubeDatum = parseAtmotubeDatum(peripheral);
              return (
                <View
                  key={key}
                  style={{
                    backgroundColor: "#eee",
                    width: "100%",
                    margin: 5,
                    padding: 5,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text>{peripheral.name || "unknown"} - </Text>
                    <Text style={{ color: "#777", fontSize: 11 }}>
                      {peripheral.id}
                    </Text>
                  </View>

                  {!!atmotubeDatum && (
                    <View
                      style={{
                        padding: 10,
                      }}
                    >
                      <Text>Device Id: {atmotubeDatum.deviceId}</Text>
                      <Text>Humidity: {atmotubeDatum.humidity}%</Text>
                      <Text>Tempreature: {atmotubeDatum.temperature}°C</Text>
                      <Text>Pressure: {atmotubeDatum.pressure} hPa</Text>
                      <Text>Battery: {atmotubeDatum.battery}%</Text>
                      <Text>VOC: {atmotubeDatum.VOC}</Text>
                      <Text>PM1: {atmotubeDatum.PM1}</Text>
                      <Text>PM2.5: {atmotubeDatum.PM25}</Text>
                      <Text>PM10: {atmotubeDatum.PM10}</Text>
                      <Text>Firmware: {atmotubeDatum.firmware}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        </View>
      );

    case "error":
      return (
        <View style={styles.container}>
          <Text>Error: {errorMessage}</Text>
        </View>
      );
  }

  return (
    <View style={styles.container}>
      <Text>Curiously, we are in an unknown state...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
