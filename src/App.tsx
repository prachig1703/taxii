import React, { useState, useEffect } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, query, where, orderBy, limit, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LiveMap } from './components/LiveMap';
import { useGPSTracking } from './hooks/useGPSTracking';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Car, 
  User, 
  LogOut, 
  Plus, 
  Calendar, 
  CheckCircle, 
  Clock, 
  MapPin, 
  Star,
  LayoutDashboard,
  Search,
  Filter,
  Bell,
  X,
  HelpCircle,
  Mail,
  Phone,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  History,
  Heart,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Award,
  FileText,
  Check,
  XCircle,
  AlertCircle
} from 'lucide-react';

// Types
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'owner' | 'driver';
  phone?: string;
  verified: boolean;
  verificationStatus?: 'none' | 'pending' | 'approved' | 'denied';
  favorites?: string[];
  
  // Trust & Verification System
  verificationData?: {
    aadhaarNumber?: string;
    licenseNumber?: string;
    licenseExpiry?: string;
    licenseVehicleType?: string;
    policeVerificationStatus: 'none' | 'pending' | 'verified' | 'failed';
    isLicenseVerified: boolean;
  };
  trustMetrics?: {
    score: number;
    onTimeReturnRate: number;
    completedBookings: number;
    accidentsCount: number;
    complaintsCount: number;
    totalRatings: number;
    averageRating: number;
  };
  isFlagged?: boolean;
  flagReason?: string;
  
  createdAt: any;
}

interface Vehicle {
  id: string;
  ownerId: string;
  model: string;
  registrationNumber: string;
  type: string;
  pricePerDay: number;
  pricePerWeek?: number;
  location: string;
  availability: boolean;
  images?: string[];
  createdAt: any;
}

interface Booking {
  id: string;
  vehicleId: string;
  driverId: string;
  ownerId: string;
  startDate: any;
  endDate: any;
  rentalType: 'daily' | 'weekly';
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  totalAmount: number;
  ownerStartReminderSent?: boolean;
  driverStartReminderSent?: boolean;
  ownerEndReminderSent?: boolean;
  driverEndReminderSent?: boolean;
  createdAt: any;
}

interface Review {
  id: string;
  fromId: string;
  toId: string;
  bookingId: string;
  vehicleId: string;
  rating: number;
  comment: string;
  createdAt: any;
}

interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'booking' | 'verification' | 'system';
  read: boolean;
  createdAt: any;
}

async function createNotification(userId: string, title: string, message: string, type: 'booking' | 'verification' | 'system') {
  try {
    await setDoc(doc(collection(db, 'notifications')), {
      userId,
      title,
      message,
      type,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

function calculateTrustScore(metrics?: UserProfile['trustMetrics']) {
  if (!metrics) return 0;
  
  // Weights
  const ratingWeight = 0.4;
  const onTimeWeight = 0.3;
  const experienceWeight = 0.2;
  const penaltyWeight = 0.1;

  // Experience factor (maxes out at 50 bookings)
  const experienceScore = Math.min(metrics.completedBookings / 50, 1) * 5;
  
  // Penalty factor
  const penalty = (metrics.accidentsCount * 1.5) + (metrics.complaintsCount * 0.5);
  
  let score = (metrics.averageRating * ratingWeight) + 
              ((metrics.onTimeReturnRate / 20) * onTimeWeight) + 
              (experienceScore * experienceWeight);
              
  score = Math.max(0, score - penalty);
  return Number(Math.min(5, score).toFixed(1));
}

function TrustBadge({ profile }: { profile: UserProfile }) {
  const score = profile.trustMetrics?.score || 0;
  const isHighTrust = score >= 4.5;
  const isMediumTrust = score >= 3.5 && score < 4.5;
  const isLowTrust = score < 3.5;

  const colorClass = isHighTrust ? 'text-green-600 bg-green-50' : 
                    isMediumTrust ? 'text-yellow-600 bg-yellow-50' : 
                    'text-red-600 bg-red-50';

  const label = isHighTrust ? 'Highly Trusted' : 
                isMediumTrust ? 'Trusted Driver' : 
                'Needs Review';

  return (
    <div className="flex flex-col gap-2">
      <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm ${colorClass} w-fit`}>
        <Award size={16} />
        <span>{label} – {score}⭐</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {profile.verificationData?.policeVerificationStatus === 'verified' && (
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
            <ShieldCheck size={10} />
            Police Verified
          </div>
        )}
        {profile.verificationData?.isLicenseVerified && (
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-600 bg-purple-50 px-2 py-1 rounded-md">
            <FileText size={10} />
            License Verified
          </div>
        )}
        {profile.trustMetrics?.accidentsCount === 0 && profile.trustMetrics?.complaintsCount === 0 && (
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
            <Check size={10} />
            Clean Driver
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationCard({ profile }: { profile: UserProfile }) {
  const [showModal, setShowModal] = useState(false);

  if (profile.role !== 'driver') return null;

  return (
    <>
      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="relative">
            <img src={profile.photoURL} alt="" className="w-20 h-20 rounded-3xl shadow-md" referrerPolicy="no-referrer" />
            {profile.verified && (
              <div className="absolute -top-2 -right-2 bg-blue-500 text-white p-1.5 rounded-full border-4 border-white">
                <ShieldCheck size={16} />
              </div>
            )}
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-900">{profile.displayName}</h3>
            <div className="mt-2">
              <TrustBadge profile={profile} />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-4">
          <div className="text-center md:text-right">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Verification Status</p>
            <div className="flex items-center gap-2">
              {profile.verificationStatus === 'approved' ? (
                <span className="text-green-600 font-bold flex items-center gap-1">
                  <CheckCircle size={18} /> Verified Account
                </span>
              ) : profile.verificationStatus === 'pending' ? (
                <span className="text-yellow-600 font-bold flex items-center gap-1">
                  <Clock size={18} /> Verification Pending
                </span>
              ) : (
                <span className="text-red-600 font-bold flex items-center gap-1">
                  <AlertCircle size={18} /> Not Verified
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="px-6 py-3 rounded-xl font-bold bg-gray-900 text-white hover:bg-gray-800 transition-all shadow-lg flex items-center gap-2"
          >
            <Shield size={18} />
            {profile.verificationStatus === 'none' ? 'Get Verified' : 'Update Documents'}
          </button>
        </div>
      </div>
      {showModal && <VerificationModal profile={profile} onClose={() => setShowModal(false)} />}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'dashboard' | 'browse' | 'onboarding' | 'admin' | 'support'>('home');
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
        setLoading(false);
      } else {
        // New user, need onboarding
        setView('onboarding');
        setLoading(false);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !profile) return;

    const checkReminders = async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const isOwner = profile.role === 'owner';
      const field = isOwner ? 'ownerId' : 'driverId';
      
      const q = query(
        collection(db, 'bookings'),
        where(field, '==', user.uid)
      );

      try {
        const snapshot = await getDocs(q);
        for (const docSnap of snapshot.docs) {
          const booking = { id: docSnap.id, ...docSnap.data() } as Booking;
          const startDate = new Date(booking.startDate.seconds * 1000);
          const endDate = new Date(booking.endDate.seconds * 1000);

          // Start reminder (24h before)
          const startReminderFlag = isOwner ? 'ownerStartReminderSent' : 'driverStartReminderSent';
          if (booking.status === 'confirmed' && !booking[startReminderFlag] && startDate <= tomorrow && startDate > now) {
            await updateDoc(doc(db, 'bookings', booking.id), { [startReminderFlag]: true });
            await createNotification(
              user.uid,
              'Upcoming Rental Reminder',
              `Your rental for booking #${booking.id.slice(-4)} starts in less than 24 hours.`,
              'booking'
            );
          }

          // End reminder (after completion)
          const endReminderFlag = isOwner ? 'ownerEndReminderSent' : 'driverEndReminderSent';
          if (booking.status === 'completed' && !booking[endReminderFlag] && endDate <= now) {
            await updateDoc(doc(db, 'bookings', booking.id), { [endReminderFlag]: true });
            await createNotification(
              user.uid,
              'Rental Completed',
              `Your rental for booking #${booking.id.slice(-4)} has ended. We hope everything went well!`,
              'booking'
            );
          }
        }
      } catch (error) {
        console.error('Error checking reminders:', error);
      }
    };

    const interval = setInterval(checkReminders, 1000 * 60 * 15); // Check every 15 minutes
    checkReminders();

    return () => clearInterval(interval);
  }, [user, profile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const completeOnboarding = async (role: 'owner' | 'driver') => {
    if (!user) return;
    const profileData: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      role,
      verified: false,
      verificationStatus: 'none',
      trustMetrics: {
        score: 5.0, // Start with a perfect score
        onTimeReturnRate: 100,
        completedBookings: 0,
        accidentsCount: 0,
        complaintsCount: 0,
        totalRatings: 0,
        averageRating: 5.0
      },
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'users', user.uid), profileData);
      setView('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
        <Navbar 
          user={user} 
          profile={profile} 
          onLogout={handleLogout} 
          onLogin={handleLogin} 
          setView={setView} 
          notifications={notifications}
        />
        
        <main className="max-w-7xl mx-auto px-4 py-8">
          <AnimatePresence mode="wait">
            {!user ? (
              <Hero onLogin={handleLogin} />
            ) : view === 'onboarding' ? (
              <Onboarding onComplete={completeOnboarding} />
            ) : !profile ? (
              <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full"
                />
              </div>
            ) : view === 'dashboard' ? (
              <Dashboard profile={profile} setView={setView} />
            ) : view === 'browse' ? (
              <BrowseVehicles profile={profile} />
            ) : view === 'admin' ? (
              <AdminDashboard />
            ) : view === 'support' ? (
              <SupportSection />
            ) : (
              <Home profile={profile} setView={setView} />
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

function NotificationCenter({ notifications, onClose }: { notifications: Notification[], onClose: () => void }) {
  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `notifications/${id}`);
    }
  };

  return (
    <div className="absolute right-0 mt-2 w-80 bg-white rounded-3xl shadow-2xl border border-gray-100 z-[100] overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
        <h4 className="font-bold">Notifications</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Bell size={32} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          notifications.map(n => (
            <div key={n.id} className={`p-4 hover:bg-gray-50 transition-colors ${!n.read ? 'bg-blue-50/30' : ''}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <p className={`text-sm font-bold ${!n.read ? 'text-gray-900' : 'text-gray-600'}`}>{n.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{n.message}</p>
                  <p className="text-[10px] text-gray-400 mt-2">
                    {n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000).toLocaleTimeString() : 'Just now'}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {!n.read && (
                    <button onClick={() => markAsRead(n.id)} className="w-2 h-2 bg-blue-500 rounded-full" title="Mark as read" />
                  )}
                  <button onClick={() => deleteNotification(n.id)} className="text-gray-300 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Navbar({ user, profile, onLogout, onLogin, setView, notifications }: any) {
  const isAdmin = profile?.email === 'prachig1703@gmail.com';
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications?.filter((n: any) => !n.read).length || 0;

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div 
          className="flex items-center gap-2 cursor-pointer" 
          onClick={() => setView('home')}
        >
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white">
            <Car size={24} />
          </div>
          <span className="font-bold text-xl tracking-tight">TaxiDaily</span>
        </div>

        <div className="flex items-center gap-6">
          {user ? (
            <>
              {isAdmin && (
                <button 
                  onClick={() => setView('admin')}
                  className="text-red-600 hover:text-red-700 font-bold transition-colors flex items-center gap-1"
                >
                  <ShieldCheck size={18} />
                  Admin
                </button>
              )}
              <button 
                onClick={() => setView('browse')}
                className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Browse
              </button>
              <button 
                onClick={() => setView('dashboard')}
                className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Dashboard
              </button>
              <button 
                onClick={() => setView('support')}
                className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Support
              </button>

              <div className="relative">
                <button 
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                      {unreadCount}
                    </span>
                  )}
                </button>
                <AnimatePresence>
                  {showNotifications && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                    >
                      <NotificationCenter 
                        notifications={notifications} 
                        onClose={() => setShowNotifications(false)} 
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-3 pl-6 border-l border-gray-100">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold leading-none">{profile?.displayName}</p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">{profile?.role}</p>
                </div>
                <img 
                  src={profile?.photoURL} 
                  alt="Profile" 
                  className="w-10 h-10 rounded-full border border-gray-100"
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={onLogout}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </div>
            </>
          ) : (
            <button 
              onClick={onLogin}
              className="bg-gray-900 text-white px-6 py-2 rounded-full font-semibold hover:bg-gray-800 transition-all shadow-sm"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function Hero({ onLogin }: { onLogin: () => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-20"
    >
      <h1 className="text-6xl font-bold tracking-tight text-gray-900 mb-6">
        The Smarter Way to <br />
        <span className="text-gray-400">Rent Your Taxi.</span>
      </h1>
      <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
        Connecting vehicle owners with professional drivers for flexible daily and weekly rentals. 
        Transparent pricing, secure bookings, and verified users.
      </p>
      <div className="flex items-center justify-center gap-4">
        <button 
          onClick={onLogin}
          className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl"
        >
          Get Started Now
        </button>
        <button className="bg-white text-gray-900 border border-gray-200 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all">
          Learn More
        </button>
      </div>

      <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
        {[
          { icon: <ShieldCheck className="text-green-500" />, title: "Verified Users", desc: "All drivers and owners undergo a strict document verification process." },
          { icon: <Clock className="text-blue-500" />, title: "Flexible Rentals", desc: "Choose between daily or weekly rental models that suit your schedule." },
          { icon: <Star className="text-yellow-500" />, title: "Rating System", desc: "Build trust through our transparent peer-to-peer rating system." }
        ].map((feature, i) => (
          <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mb-6">
              {feature.icon}
            </div>
            <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
            <p className="text-gray-600 leading-relaxed">{feature.desc}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function Onboarding({ onComplete }: { onComplete: (role: 'owner' | 'driver') => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto text-center py-12"
    >
      <h2 className="text-3xl font-bold mb-4">Welcome to TaxiDaily!</h2>
      <p className="text-gray-600 mb-12">How would you like to use the platform?</p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <button 
          onClick={() => onComplete('owner')}
          className="bg-white p-8 rounded-3xl border-2 border-gray-100 hover:border-gray-900 transition-all text-left group"
        >
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-gray-900 group-hover:text-white transition-colors">
            <LayoutDashboard size={32} />
          </div>
          <h3 className="text-xl font-bold mb-2">I am an Owner</h3>
          <p className="text-gray-600">I want to list my vehicles and find reliable drivers for rentals.</p>
        </button>

        <button 
          onClick={() => onComplete('driver')}
          className="bg-white p-8 rounded-3xl border-2 border-gray-100 hover:border-gray-900 transition-all text-left group"
        >
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-gray-900 group-hover:text-white transition-colors">
            <Car size={32} />
          </div>
          <h3 className="text-xl font-bold mb-2">I am a Driver</h3>
          <p className="text-gray-600">I want to browse available taxis and book them for flexible work.</p>
        </button>
      </div>
    </motion.div>
  );
}

function Home({ profile, setView }: { profile: UserProfile, setView: any }) {
  if (!profile) return null;
  const firstName = profile.displayName ? profile.displayName.split(' ')[0] : 'User';
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [reviewingBooking, setReviewingBooking] = useState<Booking | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where(profile.role === 'owner' ? 'ownerId' : 'driverId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRecentBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });
    return () => unsubscribe();
  }, [profile]);
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-12"
    >
      <VerificationCard profile={profile} />

      <div className="bg-gray-900 text-white p-12 rounded-[2.5rem] relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-4xl font-bold mb-4">Welcome back, {firstName}!</h2>
          <p className="text-gray-400 text-lg mb-8">
            {profile.role === 'owner' 
              ? "Your fleet is looking good. Manage your vehicles and bookings."
              : "Ready for your next shift? Browse available vehicles in your area."}
          </p>
          <button 
            onClick={() => setView(profile.role === 'owner' ? 'dashboard' : 'browse')}
            className="bg-white text-gray-900 px-8 py-3 rounded-xl font-bold hover:bg-gray-100 transition-all"
          >
            {profile.role === 'owner' ? "Manage Fleet" : "Find a Taxi"}
          </button>
        </div>
        <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-1/4 translate-y-1/4">
          <Car size={400} />
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold">Recent Activity</h3>
          <button className="text-gray-500 font-semibold hover:text-gray-900">View All</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recentBookings.length === 0 ? (
            <div className="col-span-full py-12 text-center bg-white rounded-3xl border border-gray-100">
              <p className="text-gray-500">No recent activity found.</p>
            </div>
          ) : (
            recentBookings.slice(0, 6).map((booking) => (
              <div key={booking.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
                    <Clock size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold">Booking {booking.status}</p>
                    <p className="text-sm text-gray-500">
                      {new Date(booking.startDate.seconds * 1000).toLocaleDateString()} - {new Date(booking.endDate.seconds * 1000).toLocaleDateString()}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-bold rounded-md capitalize ${
                        booking.status === 'completed' ? 'bg-green-50 text-green-600' :
                        booking.status === 'pending' ? 'bg-yellow-50 text-yellow-600' :
                        booking.status === 'confirmed' ? 'bg-blue-50 text-blue-600' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {booking.status}
                      </span>
                    </div>
                  </div>
                </div>
                {booking.status === 'completed' && profile.role === 'driver' && (
                  <button 
                    onClick={() => setReviewingBooking(booking)}
                    className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-gray-900 font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Star size={16} />
                    Leave a Review
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {reviewingBooking && (
        <ReviewModal 
          booking={reviewingBooking} 
          onClose={() => setReviewingBooking(null)} 
          profile={profile}
        />
      )}
    </motion.div>
  );
}

function Dashboard({ profile, setView }: { profile: UserProfile, setView: (view: any) => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [driverProfiles, setDriverProfiles] = useState<Record<string, UserProfile>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [selectedDriverProfile, setSelectedDriverProfile] = useState<UserProfile | null>(null);
  const [reviewingBooking, setReviewingBooking] = useState<Booking | null>(null);
  const [driverLocations, setDriverLocations] = useState<Record<string, any>>({});

  // GPS Tracking for drivers
  const hasActiveBooking = bookings.some(b => b.status === 'confirmed');
  const { location: driverLocation, error: gpsError, isOutOfZone } = useGPSTracking(
    profile.role === 'driver' ? profile.uid : undefined,
    hasActiveBooking
  );

  useEffect(() => {
    let unsubscribeVehicles = () => {};
    let unsubscribeBookings = () => {};

    if (profile.role === 'owner') {
      const vQuery = query(collection(db, 'vehicles'), where('ownerId', '==', profile.uid));
      unsubscribeVehicles = onSnapshot(vQuery, (snapshot) => {
        setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'vehicles');
      });

      const bQuery = query(collection(db, 'bookings'), where('ownerId', '==', profile.uid));
      unsubscribeBookings = onSnapshot(bQuery, (snapshot) => {
        setBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bookings');
      });
    } else {
      const bQuery = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
      unsubscribeBookings = onSnapshot(bQuery, (snapshot) => {
        setBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bookings');
      });
      
      const vQuery = query(collection(db, 'vehicles'));
      unsubscribeVehicles = onSnapshot(vQuery, (snapshot) => {
        setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'vehicles');
      });
    }

    return () => {
      unsubscribeVehicles();
      unsubscribeBookings();
    };
  }, [profile]);

  // Separate effect for driver profiles and locations
  useEffect(() => {
    if (profile.role !== 'owner' || bookings.length === 0) return;

    const allDriverIds = Array.from(new Set(bookings.map(b => b.driverId)));
    const activeDriverIds = Array.from(new Set(
      bookings.filter(b => b.status === 'confirmed').map(b => b.driverId)
    ));

    let unsubDrivers: (() => void)[] = [];
    let unsubLocations: (() => void)[] = [];

    if (allDriverIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < allDriverIds.length; i += 30) {
        chunks.push(allDriverIds.slice(i, i + 30));
      }
      unsubDrivers = chunks.map(chunk => {
        const dQuery = query(collection(db, 'users'), where('uid', 'in', chunk));
        return onSnapshot(dQuery, (snapshot) => {
          setDriverProfiles(prev => {
            const next = { ...prev };
            snapshot.docs.forEach(doc => {
              next[doc.id] = doc.data() as UserProfile;
            });
            return next;
          });
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, 'users');
        });
      });
    }

    if (activeDriverIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < activeDriverIds.length; i += 30) {
        chunks.push(activeDriverIds.slice(i, i + 30));
      }
      unsubLocations = chunks.map(chunk => {
        const lQuery = query(collection(db, 'locations'), where('driverId', 'in', chunk));
        return onSnapshot(lQuery, (snapshot) => {
          setDriverLocations(prev => {
            const next = { ...prev };
            snapshot.docs.forEach(doc => {
              next[doc.id] = doc.data();
            });
            return next;
          });
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, 'locations');
        });
      });
    }

    return () => {
      unsubDrivers.forEach(u => u());
      unsubLocations.forEach(u => u());
    };
  }, [profile.role, bookings]);

  const handleBookingStatus = async (booking: Booking, status: 'confirmed' | 'cancelled' | 'completed') => {
    try {
      await updateDoc(doc(db, 'bookings', booking.id), { status });
      
      // Update vehicle availability if confirmed or completed
      if (status === 'confirmed') {
        await updateDoc(doc(db, 'vehicles', booking.vehicleId), { availability: false });
      } else if (status === 'completed' || status === 'cancelled') {
        await updateDoc(doc(db, 'vehicles', booking.vehicleId), { availability: true });
      }

      // Notify driver
      await createNotification(
        booking.driverId,
        `Booking ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        `Your booking for vehicle ID ${booking.vehicleId} has been ${status}.`,
        'booking'
      );

      // Update driver trust metrics if completed
      if (status === 'completed') {
        const driverRef = doc(db, 'users', booking.driverId);
        const driverSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', booking.driverId)));
        if (!driverSnap.empty) {
          const driverData = driverSnap.docs[0].data() as UserProfile;
          const currentMetrics = driverData.trustMetrics || {
            score: 5,
            onTimeReturnRate: 100,
            completedBookings: 0,
            accidentsCount: 0,
            complaintsCount: 0,
            totalRatings: 0,
            averageRating: 5
          };

          const newMetrics = {
            ...currentMetrics,
            completedBookings: currentMetrics.completedBookings + 1,
            // Assume 100% on-time for now, or could be weighted
            onTimeReturnRate: Math.min(100, ((currentMetrics.onTimeReturnRate * currentMetrics.completedBookings) + 100) / (currentMetrics.completedBookings + 1))
          };

          const newScore = calculateTrustScore(newMetrics);
          await updateDoc(driverRef, {
            trustMetrics: {
              ...newMetrics,
              score: newScore
            }
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">{profile.role === 'owner' ? 'Owner Dashboard' : 'Driver Dashboard'}</h2>
          <p className="text-gray-500 mt-1">
            {profile.role === 'owner' ? 'Manage your fleet and track earnings.' : 'Track your rentals and booking history.'}
          </p>
        </div>
        {profile.role === 'owner' && (
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-800 transition-all shadow-md"
          >
            <Plus size={20} />
            Add Vehicle
          </button>
        )}
      </div>

      <VerificationCard profile={profile} />

      {profile.role === 'driver' && hasActiveBooking && (
        <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${gpsError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
              <MapPin size={24} />
            </div>
            <div>
              <h3 className="font-bold">Live GPS Tracking</h3>
              <p className="text-sm text-gray-500">
                {gpsError ? gpsError : isOutOfZone ? "⚠️ Vehicle out of allowed zone!" : "Tracking active. Your location is shared with the owner."}
              </p>
            </div>
          </div>
          {driverLocation && (
            <div className="text-right">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Current Coords</p>
              <p className="text-sm font-mono">{driverLocation.latitude.toFixed(4)}, {driverLocation.longitude.toFixed(4)}</p>
            </div>
          )}
        </div>
      )}

      {profile.role === 'owner' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: "Total Vehicles", value: vehicles.length, icon: <Car className="text-blue-500" /> },
            { label: "Pending Bookings", value: bookings.filter(b => b.status === 'pending').length, icon: <Calendar className="text-yellow-500" /> },
            { label: "Active Bookings", value: bookings.filter(b => b.status === 'confirmed').length, icon: <CheckCircle className="text-green-500" /> },
            { label: "Total Earnings", value: `$${bookings.filter(b => b.status === 'completed').reduce((acc, b) => acc + b.totalAmount, 0)}`, icon: <Star className="text-purple-500" /> }
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center mb-4">
                {stat.icon}
              </div>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { label: "Total Rentals", value: bookings.length, icon: <Car className="text-blue-500" /> },
            { label: "Active Bookings", value: bookings.filter(b => b.status === 'confirmed').length, icon: <CheckCircle className="text-green-500" /> },
            { label: "Completed", value: bookings.filter(b => b.status === 'completed').length, icon: <CheckCircle className="text-purple-500" /> }
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center mb-4">
                {stat.icon}
              </div>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {profile.role === 'owner' && (
            <section>
              <h3 className="text-xl font-bold mb-6">Your Fleet</h3>
              {vehicles.length === 0 ? (
                <div className="bg-white p-12 rounded-3xl border border-dashed border-gray-200 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                    <Car size={32} />
                  </div>
                  <p className="text-gray-500">No vehicles listed yet. Start by adding your first taxi.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {vehicles.map(v => (
                    <VehicleCard key={v.id} vehicle={v} profile={profile} isOwner />
                  ))}
                </div>
              )}
            </section>
          )}

          {profile.role === 'driver' && (
            <section>
              <div className="flex items-center gap-2 mb-6">
                <Heart className="text-red-500" size={24} fill="currentColor" />
                <h3 className="text-xl font-bold">Favorite Vehicles</h3>
              </div>
              {profile.favorites && profile.favorites.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {vehicles
                    .filter(v => profile.favorites?.includes(v.id))
                    .map(v => (
                      <VehicleCard key={v.id} vehicle={v} profile={profile} />
                    ))}
                </div>
              ) : (
                <div className="bg-white p-12 rounded-3xl border border-dashed border-gray-200 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                    <Heart size={32} />
                  </div>
                  <p className="text-gray-500">You haven't favorited any vehicles yet. Browse and save your top choices!</p>
                  <button 
                    onClick={() => setView('browse')}
                    className="mt-4 text-blue-600 font-bold hover:underline"
                  >
                    Browse Vehicles
                  </button>
                </div>
              )}
            </section>
          )}

          <section>
            <div className="flex items-center gap-2 mb-6">
              <History className="text-gray-400" size={24} />
              <h3 className="text-xl font-bold">Booking History</h3>
            </div>
            <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4 text-sm font-bold text-gray-600">Vehicle</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-600">Dates</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-600">Status</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-600 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                          No bookings found.
                        </td>
                      </tr>
                    ) : (
                      bookings.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(b => {
                        const vehicle = vehicles.find(v => v.id === b.vehicleId);
                        return (
                          <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                                  <Car size={20} />
                                </div>
                                <div>
                                  <p className="font-bold text-sm">{vehicle?.model || 'Unknown Vehicle'}</p>
                                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">{vehicle?.registrationNumber || 'N/A'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium">
                                {new Date(b.startDate.seconds * 1000).toLocaleDateString()}
                              </p>
                              <p className="text-xs text-gray-400">
                                to {new Date(b.endDate.seconds * 1000).toLocaleDateString()}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 text-[10px] font-bold rounded-md capitalize ${
                                b.status === 'confirmed' ? 'bg-green-50 text-green-600' :
                                b.status === 'pending' ? 'bg-yellow-50 text-yellow-600' :
                                b.status === 'completed' ? 'bg-blue-50 text-blue-600' :
                                'bg-red-50 text-red-600'
                              }`}>
                                {b.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex flex-col items-end gap-2">
                                <p className="font-bold text-sm">${b.totalAmount}</p>
                                {b.status === 'completed' && (
                                  <button 
                                    onClick={() => setReviewingBooking(b)}
                                    className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    <Star size={10} />
                                    Review
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        {profile.role === 'owner' && (
          <div className="space-y-8">
            <section>
              <h3 className="text-xl font-bold mb-6">Manage Bookings</h3>
              <div className="space-y-4">
                {bookings.filter(b => b.status === 'pending' || b.status === 'confirmed').length === 0 ? (
                  <div className="bg-white p-8 rounded-3xl border border-gray-100 text-center text-gray-500">
                    No active bookings to manage.
                  </div>
                ) : (
                  bookings.filter(b => b.status === 'pending' || b.status === 'confirmed').map(b => (
                    <div key={b.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold">Booking #{b.id.slice(-4)}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(b.startDate.seconds * 1000).toLocaleDateString()} - {new Date(b.endDate.seconds * 1000).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`px-2 py-1 text-[10px] font-bold rounded-md capitalize ${
                          b.status === 'confirmed' ? 'bg-green-50 text-green-600' :
                          b.status === 'pending' ? 'bg-yellow-50 text-yellow-600' :
                          b.status === 'completed' ? 'bg-blue-50 text-blue-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          {b.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">Total Amount</span>
                        <span className="font-bold">${b.totalAmount}</span>
                      </div>
                      
                      {driverProfiles[b.driverId] && (
                        <div className="pt-4 border-t border-gray-50">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Driver Trust Profile</p>
                          <div 
                            className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded-2xl transition-colors"
                            onClick={() => setSelectedDriverProfile(driverProfiles[b.driverId])}
                          >
                            <img src={driverProfiles[b.driverId].photoURL} alt="" className="w-10 h-10 rounded-xl" referrerPolicy="no-referrer" />
                            <div>
                              <p className="text-sm font-bold">{driverProfiles[b.driverId].displayName}</p>
                              <div className="scale-75 origin-left -mt-1">
                                <TrustBadge profile={driverProfiles[b.driverId]} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {b.status === 'confirmed' && driverLocations[b.driverId] && (
                        <div className="pt-4 border-t border-gray-50 space-y-3">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Live Location</p>
                          <LiveMap 
                            latitude={driverLocations[b.driverId].latitude} 
                            longitude={driverLocations[b.driverId].longitude}
                            label={`${driverProfiles[b.driverId]?.displayName || 'Driver'}'s Location`}
                          />
                          {/* Geofence check for owner */}
                          {(() => {
                            const loc = driverLocations[b.driverId];
                            if (loc.startLatitude && loc.startLongitude) {
                              const R = 6371;
                              const dLat = (loc.latitude - loc.startLatitude) * (Math.PI / 180);
                              const dLon = (loc.longitude - loc.startLongitude) * (Math.PI / 180);
                              const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                Math.cos(loc.startLatitude * (Math.PI / 180)) * Math.cos(loc.latitude * (Math.PI / 180)) *
                                Math.sin(dLon / 2) * Math.sin(dLon / 2);
                              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                              const distance = R * c;
                              if (distance > 5) {
                                return (
                                  <div className="bg-red-50 p-3 rounded-xl flex items-center gap-2 text-red-600 text-xs font-bold">
                                    <AlertTriangle size={14} />
                                    Vehicle out of allowed zone ({distance.toFixed(1)}km away)
                                  </div>
                                );
                              }
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {b.status === 'pending' && (
                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => handleBookingStatus(b, 'cancelled')}
                            className="flex-1 py-2 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-all"
                          >
                            Decline
                          </button>
                          <button 
                            onClick={() => handleBookingStatus(b, 'confirmed')}
                            className="flex-1 py-2 rounded-xl text-sm font-bold bg-gray-900 text-white hover:bg-gray-800 transition-all"
                          >
                            Confirm
                          </button>
                        </div>
                      )}
                      {b.status === 'confirmed' && (
                        <button 
                          onClick={() => handleBookingStatus(b, 'completed')}
                          className="w-full py-2 rounded-xl text-sm font-bold bg-green-500 text-white hover:bg-green-600 transition-all"
                        >
                          Mark Completed
                        </button>
                      )}
                      
                      {b.status === 'completed' && (
                        <button 
                          onClick={() => setReviewingBooking(b)}
                          className="w-full py-2 rounded-xl text-sm font-bold border border-gray-200 text-gray-600 hover:border-gray-900 transition-all flex items-center justify-center gap-2"
                        >
                          <Star size={14} />
                          Review Driver
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {isAdding && <AddVehicleModal onClose={() => setIsAdding(false)} ownerId={profile.uid} />}
      {selectedDriverProfile && <DriverProfileModal profile={selectedDriverProfile} onClose={() => setSelectedDriverProfile(null)} />}
      {reviewingBooking && <ReviewModal booking={reviewingBooking} onClose={() => setReviewingBooking(null)} profile={profile} />}
    </motion.div>
  );
}

function BrowseVehicles({ profile }: { profile: UserProfile }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('All Types');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'vehicles'), where('availability', '==', true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles');
    });
    return () => unsubscribe();
  }, []);

  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch = v.model.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         v.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === 'All Types' || v.type === selectedType;
    const matchesMinPrice = priceRange.min === '' || v.pricePerDay >= Number(priceRange.min);
    const matchesMaxPrice = priceRange.max === '' || v.pricePerDay <= Number(priceRange.max);
    
    return matchesSearch && matchesType && matchesMinPrice && matchesMaxPrice;
  });

  const vehicleTypes = ['All Types', 'Sedan', 'SUV', 'Hatchback', 'Luxury'];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Find a Vehicle</h2>
          <p className="text-gray-500 mt-1">Browse available taxis for your next shift.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="text" 
              placeholder="Search by model or location..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`p-3 rounded-2xl border transition-all ${showFilters ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-900'}`}
          >
            <Filter size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">Vehicle Type</label>
                  <div className="flex flex-wrap gap-2">
                    {vehicleTypes.map((type) => (
                      <button 
                        key={type}
                        onClick={() => setSelectedType(type)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedType === type ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">Price Range (Daily)</label>
                  <div className="flex items-center gap-4">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input 
                        type="number" 
                        placeholder="Min"
                        className="w-full pl-8 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none transition-all"
                        value={priceRange.min}
                        onChange={(e) => setPriceRange({...priceRange, min: e.target.value})}
                      />
                    </div>
                    <span className="text-gray-400">to</span>
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input 
                        type="number" 
                        placeholder="Max"
                        className="w-full pl-8 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none transition-all"
                        value={priceRange.max}
                        onChange={(e) => setPriceRange({...priceRange, max: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={() => {
                    setSelectedType('All Types');
                    setPriceRange({ min: '', max: '' });
                    setSearchTerm('');
                  }}
                  className="text-sm font-bold text-gray-400 hover:text-gray-900 transition-colors"
                >
                  Reset All Filters
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showFilters && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {vehicleTypes.map((type) => (
            <button 
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-6 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${selectedType === type ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-100 hover:bg-gray-50'}`}
            >
              {type}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredVehicles.length > 0 ? (
          filteredVehicles.map(v => (
            <VehicleCard key={v.id} vehicle={v} profile={profile} />
          ))
        ) : (
          <div className="col-span-full py-20 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <Search size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900">No vehicles found</h3>
            <p className="text-gray-500 mt-2">Try adjusting your filters or search terms.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface VehicleCardProps {
  vehicle: Vehicle;
  profile: UserProfile;
  isOwner?: boolean;
  key?: string;
}

function VehicleCard({ vehicle, profile, isOwner }: VehicleCardProps) {
  const [isBooking, setIsBooking] = useState(false);
  const isFavorite = profile?.favorites?.includes(vehicle.id);

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile) return;

    const newFavorites = isFavorite 
      ? (profile.favorites || []).filter(id => id !== vehicle.id)
      : [...(profile.favorites || []), vehicle.id];

    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        favorites: newFavorites
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  const displayImage = vehicle.images && vehicle.images.length > 0 
    ? vehicle.images[0] 
    : `https://picsum.photos/seed/${vehicle.model}/800/500`;

  return (
    <>
      <motion.div 
        whileHover={{ y: -4 }}
        className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden group"
      >
      <div className="aspect-[16/10] bg-gray-100 relative">
        <img 
          src={displayImage} 
          alt={vehicle.model}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-4 right-4 flex gap-2">
          {!isOwner && (
            <button 
              onClick={toggleFavorite}
              className={`p-2 rounded-full backdrop-blur-md transition-all ${
                isFavorite 
                  ? 'bg-red-500 text-white shadow-lg' 
                  : 'bg-white/80 text-gray-600 hover:bg-white'
              }`}
            >
              <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${vehicle.availability ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
            {vehicle.availability ? 'Available' : 'Booked'}
          </span>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h4 className="text-xl font-bold text-gray-900">{vehicle.model}</h4>
            <div className="flex items-center gap-1 text-gray-500 text-sm mt-1">
              <MapPin size={14} />
              <span>{vehicle.location}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">${vehicle.pricePerDay}</p>
            <p className="text-xs text-gray-500 font-medium">per day</p>
            {vehicle.pricePerWeek && (
              <p className="text-sm font-bold text-gray-400 mt-1">${vehicle.pricePerWeek}/wk</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 mt-6 pt-6 border-t border-gray-50">
          <div className="flex items-center gap-1 text-sm font-medium text-gray-600">
            <Car size={16} className="text-gray-400" />
            <span>{vehicle.type}</span>
          </div>
          <div className="flex items-center gap-1 text-sm font-medium text-gray-600">
            <ShieldCheck size={16} className="text-gray-400" />
            <span>Insured</span>
          </div>
        </div>

        {!isOwner && (
          <button 
            onClick={() => setIsBooking(true)}
            className="w-full mt-6 bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-sm group-hover:shadow-md"
          >
            Book Now
          </button>
        )}
      </div>
      </motion.div>
      {isBooking && (
        <BookingModal 
          vehicle={vehicle} 
          driverId={profile.uid} 
          onClose={() => setIsBooking(false)} 
        />
      )}
    </>
  );
}

function BookingModal({ vehicle, driverId, onClose }: { vehicle: Vehicle, driverId: string, onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    rentalType: 'daily' as 'daily' | 'weekly',
  });
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toLocaleDateString('en-CA');

  const calculateTotal = () => {
    if (!formData.startDate || !formData.endDate) return 0;
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    if (formData.rentalType === 'weekly') {
      const weeks = Math.ceil(diffDays / 7);
      return weeks * (vehicle.pricePerWeek || (vehicle.pricePerDay * 7));
    }
    return diffDays * vehicle.pricePerDay;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const selectedStart = new Date(formData.startDate);
    const selectedEnd = new Date(formData.endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (selectedStart < now) {
      alert('Past dates are not allowed for booking.');
      return;
    }

    if (selectedEnd < selectedStart) {
      alert('End date cannot be before start date.');
      return;
    }

    if (step === 1) {
      setStep(2);
      return;
    }
    
    setSubmitting(true);

    try {
      const totalAmount = calculateTotal();
      const bookingData = {
        vehicleId: vehicle.id,
        driverId,
        ownerId: vehicle.ownerId,
        startDate: new Date(formData.startDate),
        endDate: new Date(formData.endDate),
        rentalType: formData.rentalType,
        status: 'pending',
        totalAmount,
        createdAt: serverTimestamp(),
      };

      const newDocRef = doc(collection(db, 'bookings'));
      await setDoc(newDocRef, bookingData);
      
      // Notify owner
      await createNotification(
        vehicle.ownerId,
        'New Booking Request',
        `You have a new booking request for your ${vehicle.model}.`,
        'booking'
      );

      onClose();
      alert('Booking request sent successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
    } finally {
      setSubmitting(false);
    }
  };

  const totalAmount = calculateTotal();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl"
      >
        <h3 className="text-2xl font-bold mb-2">
          {step === 1 ? `Book ${vehicle.model}` : 'Confirm Booking'}
        </h3>
        <p className="text-gray-500 mb-6">
          {step === 1 ? 'Enter your rental details below.' : 'Please review your rental summary.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Start Date</label>
                  <input 
                    required
                    type="date" 
                    min={today}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    value={formData.startDate}
                    onChange={e => setFormData({...formData, startDate: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">End Date</label>
                  <input 
                    required
                    type="date" 
                    min={formData.startDate || today}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    value={formData.endDate}
                    onChange={e => setFormData({...formData, endDate: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Rental Type</label>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    type="button"
                    onClick={() => setFormData({...formData, rentalType: 'daily'})}
                    className={`py-3 rounded-xl font-bold border-2 transition-all ${formData.rentalType === 'daily' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-100 text-gray-600 hover:border-gray-200'}`}
                  >
                    Daily
                  </button>
                  <button 
                    type="button"
                    disabled={!vehicle.pricePerWeek}
                    onClick={() => setFormData({...formData, rentalType: 'weekly'})}
                    className={`py-3 rounded-xl font-bold border-2 transition-all ${formData.rentalType === 'weekly' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-100 text-gray-600 hover:border-gray-200'} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    Weekly
                  </button>
                </div>
                {!vehicle.pricePerWeek && <p className="text-xs text-gray-400 mt-2">Weekly discount not available for this vehicle.</p>}
              </div>
            </>
          ) : (
            <div className="space-y-4 bg-gray-50 p-6 rounded-3xl border border-gray-100">
              <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                <span className="text-gray-500">Vehicle</span>
                <span className="font-bold">{vehicle.model}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                <span className="text-gray-500">Duration</span>
                <span className="font-bold">{formData.startDate} to {formData.endDate}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                <span className="text-gray-500">Rental Type</span>
                <span className="font-bold capitalize">{formData.rentalType}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-gray-900 font-bold text-lg">Total Amount</span>
                <span className="text-2xl font-black text-gray-900">${totalAmount}</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="bg-gray-50 p-4 rounded-2xl mt-6">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 font-medium">Estimated Total</span>
                <span className="text-2xl font-bold text-gray-900">${totalAmount}</span>
              </div>
            </div>
          )}

          <div className="flex gap-4 mt-8">
            <button 
              type="button"
              disabled={submitting}
              onClick={step === 1 ? onClose : () => setStep(1)}
              className="flex-1 px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <button 
              type="submit"
              disabled={submitting || (step === 1 && (!formData.startDate || !formData.endDate))}
              className="flex-1 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? 'Processing...' : step === 1 ? 'Review Booking' : 'Confirm & Pay'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function SupportSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    {
      q: "How do I list my vehicle?",
      a: "Go to your Dashboard, click 'Add Vehicle', fill in the details and upload at least one clear photo. Once submitted, our team will review it within 24 hours."
    },
    {
      q: "What documents do I need as a driver?",
      a: "You need a valid commercial driving license, a background check certificate, and a proof of address. You can upload these in your profile settings."
    },
    {
      q: "How does the payment system work?",
      a: "Payments are handled securely through our platform. Drivers pay the rental fee upfront, and owners receive payouts minus our service fee within 48 hours of booking completion."
    },
    {
      q: "What happens if there's an accident?",
      a: "Safety is our priority. In case of an accident, ensure everyone is safe, call emergency services if needed, and then report the incident through the 'Help' button in your active booking."
    }
  ];

  const guides = [
    {
      title: "Owner's Guide",
      steps: [
        "Create an account and verify your identity.",
        "List your vehicle with accurate details and high-quality photos.",
        "Set your daily and weekly rental rates.",
        "Review driver requests and confirm bookings.",
        "Hand over the keys and start earning!"
      ]
    },
    {
      title: "Driver's Guide",
      steps: [
        "Complete your profile and upload required documents.",
        "Browse available vehicles in your preferred location.",
        "Send booking requests to owners.",
        "Once confirmed, pay the rental fee securely.",
        "Pick up the vehicle and start your shift."
      ]
    }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-20"
    >
      <div className="text-center max-w-3xl mx-auto">
        <h2 className="text-4xl font-bold mb-4">Help & Support</h2>
        <p className="text-gray-600 text-lg">
          Everything you need to know about using TaxiDaily. Can't find what you're looking for? Reach out to our team.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* FAQs */}
        <section className="space-y-6">
          <h3 className="text-2xl font-bold flex items-center gap-2">
            <HelpCircle className="text-blue-500" />
            Frequently Asked Questions
          </h3>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <button 
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <span className="font-bold text-gray-900">{faq.q}</span>
                  {openFaq === i ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="px-6 pb-6 text-gray-600 leading-relaxed"
                    >
                      {faq.a}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        {/* Guides */}
        <section className="space-y-6">
          <h3 className="text-2xl font-bold flex items-center gap-2">
            <Search className="text-green-500" />
            Platform Guides
          </h3>
          <div className="grid grid-cols-1 gap-6">
            {guides.map((guide, i) => (
              <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                <h4 className="text-xl font-bold mb-6 text-gray-900">{guide.title}</h4>
                <div className="space-y-4">
                  {guide.steps.map((step, si) => (
                    <div key={si} className="flex gap-4">
                      <div className="w-6 h-6 bg-gray-900 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {si + 1}
                      </div>
                      <p className="text-gray-600">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Contact Support */}
      <section className="bg-gray-900 text-white p-12 rounded-[2.5rem] text-center">
        <h3 className="text-3xl font-bold mb-4">Still need help?</h3>
        <p className="text-gray-400 mb-10 max-w-xl mx-auto">
          Our support team is available 24/7 to assist you with any questions or issues you may encounter.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/5 p-6 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
            <Mail className="mx-auto mb-4 text-blue-400" size={32} />
            <p className="font-bold">Email Us</p>
            <p className="text-sm text-gray-400 mt-1">support@taxidaily.com</p>
          </div>
          <div className="bg-white/5 p-6 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
            <Phone className="mx-auto mb-4 text-green-400" size={32} />
            <p className="font-bold">Call Us</p>
            <p className="text-sm text-gray-400 mt-1">+1 (800) TAXI-HELP</p>
          </div>
          <div className="bg-white/5 p-6 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
            <MessageSquare className="mx-auto mb-4 text-purple-400" size={32} />
            <p className="font-bold">Live Chat</p>
            <p className="text-sm text-gray-400 mt-1">Available in-app</p>
          </div>
        </div>
      </section>
    </motion.div>
  );
}

function AdminDashboard() {
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('verificationStatus', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPendingUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return () => unsubscribe();
  }, []);

  const handleAction = async (userId: string, status: 'approved' | 'denied' | 'pending', verificationData?: any) => {
    try {
      const updateData: any = {
        verificationStatus: status,
        verified: status === 'approved'
      };

      if (verificationData) {
        updateData.verificationData = verificationData;
      }

      await updateDoc(doc(db, 'users', userId), updateData);

      // Notify user
      await createNotification(
        userId,
        'Verification Update',
        `Your account verification has been ${status}.`,
        'verification'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Admin Dashboard</h2>
        <p className="text-gray-500 mt-1">Manage user verification requests.</p>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-100">
          <h3 className="text-xl font-bold">Pending Verifications ({pendingUsers.length})</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {pendingUsers.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No pending requests at the moment.
            </div>
          ) : (
            pendingUsers.map(u => (
              <div key={u.uid} className="p-8 space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img src={u.photoURL} alt="" className="w-16 h-16 rounded-2xl shadow-sm" referrerPolicy="no-referrer" />
                    <div>
                      <p className="text-xl font-bold text-gray-900">{u.displayName}</p>
                      <p className="text-sm text-gray-500">{u.email} • <span className="capitalize font-medium">{u.role}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleAction(u.uid, 'denied')}
                      className="px-6 py-2.5 rounded-xl font-bold text-red-600 hover:bg-red-50 transition-all"
                    >
                      Reject All
                    </button>
                    <button 
                      onClick={() => handleAction(u.uid, 'approved')}
                      className="px-6 py-2.5 rounded-xl font-bold bg-gray-900 text-white hover:bg-gray-800 transition-all shadow-lg"
                    >
                      Approve All
                    </button>
                  </div>
                </div>

                {u.verificationData && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-6 rounded-3xl border border-gray-100">
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                        <FileText size={14} />
                        Government ID Details
                      </h4>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-gray-700">Aadhaar: <span className="font-mono text-gray-900">{u.verificationData.aadhaarNumber || 'Not provided'}</span></p>
                        <p className="text-sm font-medium text-gray-700">DL Number: <span className="font-mono text-gray-900">{u.verificationData.licenseNumber || 'Not provided'}</span></p>
                        <p className="text-sm font-medium text-gray-700">DL Expiry: <span className="text-gray-900">{u.verificationData.licenseExpiry || 'N/A'}</span></p>
                        <p className="text-sm font-medium text-gray-700">Vehicle Type: <span className="text-gray-900">{u.verificationData.licenseVehicleType || 'N/A'}</span></p>
                      </div>
                      <button 
                        onClick={() => handleAction(u.uid, 'pending', { ...u.verificationData, isLicenseVerified: true })}
                        disabled={u.verificationData.isLicenseVerified}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                          u.verificationData.isLicenseVerified 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-900'
                        }`}
                      >
                        {u.verificationData.isLicenseVerified ? <ShieldCheck size={14} /> : <Shield size={14} />}
                        {u.verificationData.isLicenseVerified ? 'License Verified' : 'Verify License'}
                      </button>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                        <Shield size={14} />
                        Police Verification
                      </h4>
                      <div className="flex items-center gap-3">
                        <select 
                          value={u.verificationData.policeVerificationStatus}
                          onChange={(e) => handleAction(u.uid, 'pending', { ...u.verificationData, policeVerificationStatus: e.target.value })}
                          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-900"
                        >
                          <option value="none">Not Started</option>
                          <option value="pending">In Progress</option>
                          <option value="verified">Verified</option>
                          <option value="failed">Failed</option>
                        </select>
                        {u.verificationData.policeVerificationStatus === 'verified' && <Check className="text-green-500" size={20} />}
                        {u.verificationData.policeVerificationStatus === 'failed' && <XCircle className="text-red-500" size={20} />}
                      </div>
                      <p className="text-xs text-gray-500">Update status based on background check reports.</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}

function DriverProfileModal({ profile, onClose }: { profile: UserProfile, onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold">Driver Profile</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-start mb-10">
          <img src={profile.photoURL} alt="" className="w-32 h-32 rounded-[2rem] shadow-lg" referrerPolicy="no-referrer" />
          <div className="flex-1">
            <h4 className="text-3xl font-bold text-gray-900 mb-2">{profile.displayName}</h4>
            <p className="text-gray-500 mb-4 flex items-center gap-2">
              <MapPin size={16} /> Verified Driver since {new Date(profile.createdAt?.seconds * 1000).toLocaleDateString()}
            </p>
            <TrustBadge profile={profile} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="bg-gray-50 p-6 rounded-3xl">
            <h5 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Verification Badges</h5>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Police Verification</span>
                {profile.verificationData?.policeVerificationStatus === 'verified' ? (
                  <span className="text-green-600 font-bold flex items-center gap-1 text-sm"><ShieldCheck size={16} /> Verified</span>
                ) : (
                  <span className="text-gray-400 font-bold flex items-center gap-1 text-sm"><ShieldAlert size={16} /> Pending</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">License Status</span>
                {profile.verificationData?.isLicenseVerified ? (
                  <span className="text-green-600 font-bold flex items-center gap-1 text-sm"><CheckCircle size={16} /> Valid</span>
                ) : (
                  <span className="text-gray-400 font-bold flex items-center gap-1 text-sm"><AlertCircle size={16} /> Unverified</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Aadhaar Linked</span>
                {profile.verificationData?.aadhaarNumber ? (
                  <span className="text-green-600 font-bold flex items-center gap-1 text-sm"><Check size={16} /> Yes</span>
                ) : (
                  <span className="text-red-600 font-bold flex items-center gap-1 text-sm"><X size={16} /> No</span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-6 rounded-3xl">
            <h5 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Driving History</h5>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Total Bookings</span>
                <span className="font-bold">{profile.trustMetrics?.completedBookings || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Accidents Reported</span>
                <span className={`font-bold ${profile.trustMetrics?.accidentsCount ? 'text-red-600' : 'text-green-600'}`}>
                  {profile.trustMetrics?.accidentsCount || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Complaints</span>
                <span className={`font-bold ${profile.trustMetrics?.complaintsCount ? 'text-red-600' : 'text-green-600'}`}>
                  {profile.trustMetrics?.complaintsCount || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">On-time Return</span>
                <span className="font-bold text-blue-600">{profile.trustMetrics?.onTimeReturnRate || 100}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 p-6 rounded-3xl flex gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h5 className="font-bold text-blue-900 mb-1">Trust Guarantee</h5>
            <p className="text-sm text-blue-800 leading-relaxed">
              This driver has been verified by our admin team and has a clean driving record. We recommend them for your vehicle.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ReviewModal({ booking, onClose, profile }: { booking: Booking, onClose: () => void, profile: UserProfile }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const isReviewingOwner = profile.role === 'driver';
      const toId = isReviewingOwner ? booking.ownerId : booking.driverId;

      const reviewData = {
        fromId: profile.uid,
        toId,
        bookingId: booking.id,
        vehicleId: booking.vehicleId,
        rating,
        comment,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(collection(db, 'reviews')), reviewData);

      // Update recipient trust metrics
      const userRef = doc(db, 'users', toId);
      const userSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', toId)));
      
      if (!userSnap.empty) {
        const userData = userSnap.docs[0].data() as UserProfile;
        const currentMetrics = userData.trustMetrics || {
          score: 5,
          onTimeReturnRate: 100,
          completedBookings: 0,
          accidentsCount: 0,
          complaintsCount: 0,
          totalRatings: 0,
          averageRating: 5
        };

        const newTotalRatings = currentMetrics.totalRatings + 1;
        const newAverageRating = ((currentMetrics.averageRating * currentMetrics.totalRatings) + rating) / newTotalRatings;
        
        const newMetrics = {
          ...currentMetrics,
          totalRatings: newTotalRatings,
          averageRating: Number(newAverageRating.toFixed(1))
        };

        const newScore = calculateTrustScore(newMetrics);
        await updateDoc(userRef, {
          trustMetrics: {
            ...newMetrics,
            score: newScore
          }
        });
      }

      onClose();
      alert('Thank you for your review!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'reviews');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl"
      >
        <h3 className="text-2xl font-bold mb-2">Leave a Review</h3>
        <p className="text-gray-500 mb-6">How was your experience with this rental?</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-3 text-center">Your Rating</label>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                >
                  <Star 
                    size={32} 
                    className={star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"} 
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Your Comment</label>
            <textarea
              required
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none resize-none"
              placeholder="Tell us about the vehicle and the owner..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          <div className="flex gap-4 mt-8">
            <button 
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={submitting}
              className="flex-1 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function VerificationModal({ profile, onClose }: { profile: UserProfile, onClose: () => void }) {
  const [formData, setFormData] = useState({
    aadhaarNumber: profile.verificationData?.aadhaarNumber || '',
    licenseNumber: profile.verificationData?.licenseNumber || '',
    licenseExpiry: profile.verificationData?.licenseExpiry || '',
    licenseVehicleType: profile.verificationData?.licenseVehicleType || 'Light Motor Vehicle (LMV)',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        verificationData: {
          ...formData,
          policeVerificationStatus: profile.verificationData?.policeVerificationStatus || 'none',
          isLicenseVerified: false
        },
        verificationStatus: 'pending'
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold">Driver Verification</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="bg-blue-50 p-4 rounded-2xl mb-8 flex gap-3">
          <ShieldCheck className="text-blue-600 shrink-0" size={24} />
          <p className="text-sm text-blue-800 leading-relaxed">
            Submit your documents for verification to increase your <strong>Trust Score</strong> and get more booking requests.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Aadhaar Number</label>
              <input 
                required
                type="text" 
                pattern="[0-9]{12}"
                title="12-digit Aadhaar number"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                placeholder="1234 5678 9012"
                value={formData.aadhaarNumber}
                onChange={e => setFormData({...formData, aadhaarNumber: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Driving License Number</label>
              <input 
                required
                type="text" 
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                placeholder="DL-XXXXXXXXXXXXX"
                value={formData.licenseNumber}
                onChange={e => setFormData({...formData, licenseNumber: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">DL Expiry Date</label>
                <input 
                  required
                  type="date" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                  value={formData.licenseExpiry}
                  onChange={e => setFormData({...formData, licenseExpiry: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Vehicle Type</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none bg-white"
                  value={formData.licenseVehicleType}
                  onChange={e => setFormData({...formData, licenseVehicleType: e.target.value})}
                >
                  <option>Light Motor Vehicle (LMV)</option>
                  <option>Transport Vehicle (TR)</option>
                  <option>Motorcycle with Gear (MCWG)</option>
                </select>
              </div>
            </div>
          </div>

          <button 
            type="submit"
            disabled={submitting}
            className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? 'Submitting...' : 'Submit for Verification'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function AddVehicleModal({ onClose, ownerId }: { onClose: () => void, ownerId: string }) {
  const [formData, setFormData] = useState({
    model: '',
    registrationNumber: '',
    type: 'Sedan',
    pricePerDay: '',
    pricePerWeek: '',
    location: '',
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Use a ref to keep track of previews for cleanup on unmount
  const previewsRef = React.useRef<string[]>([]);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    return () => {
      previewsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      addFiles(files);
    }
  };

  const addFiles = (files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/'));
    setSelectedFiles(prev => [...prev, ...validFiles]);
    const newPreviews = validFiles.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files) as File[];
      addFiles(files);
    }
  };

  const removeFile = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      alert('Please upload at least one image of the vehicle.');
      return;
    }
    setUploading(true);

    try {
      const timestamp = Date.now();
      
      // Upload images in parallel
      const uploadPromises = selectedFiles.map(async (file) => {
        const fileRef = ref(storage, `vehicles/${ownerId}/${timestamp}_${file.name}`);
        await uploadBytes(fileRef, file);
        return getDownloadURL(fileRef);
      });

      const imageUrls = await Promise.all(uploadPromises);

      const vehicleData: any = {
        ...formData,
        ownerId,
        pricePerDay: Number(formData.pricePerDay),
        availability: true,
        images: imageUrls,
        createdAt: serverTimestamp(),
      };

      if (formData.pricePerWeek) {
        vehicleData.pricePerWeek = Number(formData.pricePerWeek);
      }

      const newDocRef = doc(collection(db, 'vehicles'));
      await setDoc(newDocRef, vehicleData);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'vehicles');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-2xl font-bold mb-6">Add New Vehicle</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Vehicle Model</label>
            <input 
              required
              type="text" 
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
              placeholder="e.g. Toyota Camry 2023"
              value={formData.model}
              onChange={e => setFormData({...formData, model: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Reg. Number</label>
              <input 
                required
                type="text" 
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                placeholder="ABC-1234"
                value={formData.registrationNumber}
                onChange={e => setFormData({...formData, registrationNumber: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Type</label>
              <select 
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none bg-white"
                value={formData.type}
                onChange={e => setFormData({...formData, type: e.target.value})}
              >
                <option>Sedan</option>
                <option>SUV</option>
                <option>Hatchback</option>
                <option>Luxury</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Price / Day ($)</label>
              <input 
                required
                type="number" 
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                placeholder="50"
                value={formData.pricePerDay}
                onChange={e => setFormData({...formData, pricePerDay: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Price / Week (Optional)</label>
              <input 
                type="number" 
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                placeholder="300"
                value={formData.pricePerWeek}
                onChange={e => setFormData({...formData, pricePerWeek: e.target.value})}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Location</label>
            <input 
              required
              type="text" 
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-gray-900 focus:outline-none"
              placeholder="City, Area"
              value={formData.location}
              onChange={e => setFormData({...formData, location: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Vehicle Images</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-xl transition-colors ${
                isDragging ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-900'
              }`}
            >
              <div className="space-y-1 text-center">
                <Plus className={`mx-auto h-12 w-12 transition-colors ${isDragging ? 'text-gray-900' : 'text-gray-400'}`} />
                <div className="flex text-sm text-gray-600">
                  <label className="relative cursor-pointer bg-white rounded-md font-medium text-gray-900 hover:text-gray-700">
                    <span>Upload files</span>
                    <input 
                      type="file" 
                      multiple 
                      accept="image/*" 
                      className="sr-only" 
                      onChange={handleFileChange}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
              </div>
            </div>
            {previews.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-4">
                {previews.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden group">
                    <img 
                      src={url} 
                      alt={`Preview ${i}`} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-4 mt-8">
            <button 
              type="button"
              disabled={uploading}
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={uploading}
              className="flex-1 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                  Uploading...
                </>
              ) : 'Save Vehicle'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
